import React, { useState, useRef, useCallback, useEffect } from 'react';
import YouTube, { YouTubePlayer, YouTubeEvent } from 'react-youtube';
import pako from 'pako';
import './App.css';

// Compact format for URL sharing (short keys to save space)
interface CompactAnnotation {
  t: number;  // timestamp
  n: string;  // title (note)
  d?: string; // description
}

interface CompactShareData {
  v: string;  // videoId or URL
  t: string;  // title
  g: string;  // generalNotes
  a: CompactAnnotation[]; // annotations
  l?: boolean; // isLocalFile
}

// Compact format for playlist URL sharing
interface CompactPlaylistItem {
  v: string;  // videoId
  u: string;  // url
  t: string;  // title
  l?: boolean; // isLocalFile
  f?: string;  // localFileName
}

interface CompactAmbientSound {
  v: string;  // videoId
  t: string;  // title
}

interface CompactPlaylistData {
  n: string;  // name
  i: CompactPlaylistItem[]; // items
  lp: boolean; // loop
  sr?: boolean; // startRandom
  rt?: boolean; // randomTime
  as?: CompactAmbientSound[]; // ambientSounds
}

// Data structures
interface Annotation {
  id: string;
  timestamp: number;
  title: string;
  description?: string;
}

interface SavedVideo {
  id: string;
  videoId: string;
  title: string;
  url: string;
  generalNotes: string;
  annotations: Annotation[];
  createdAt: number;
  isLocalFile?: boolean;
  localFileName?: string;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  isExpanded: boolean;
}

interface PlaylistItem {
  id: string;
  videoId: string; // YouTube video ID or empty for local
  url: string;
  title: string;
  isLocalFile?: boolean;
  localFileName?: string;
}

interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
  createdAt: number;
  loop: boolean;
  startRandom?: boolean;
  randomTime?: boolean; // Start each video at a random time
}

// Saved ambient sound
interface AmbientSound {
  id: string;
  videoId: string;
  title: string;
}

interface AppData {
  folders: Folder[];
  videos: SavedVideo[];
  playlists: Playlist[];
  ambientSounds?: AmbientSound[];
}

// Drag and drop types
type DragItemType = 'folder' | 'video';
interface DragItem {
  type: DragItemType;
  id: string;
}

// Helper functions
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return url.length === 11 ? url : null;
}

// Load/Save to localStorage
function loadAppData(): AppData {
  const saved = localStorage.getItem('youtube-notes-data');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      return {
        folders: data.folders || [],
        videos: data.videos || [],
        playlists: data.playlists || [],
        ambientSounds: data.ambientSounds || [],
      };
    } catch {
      return { folders: [], videos: [], playlists: [], ambientSounds: [] };
    }
  }
  return { folders: [], videos: [], playlists: [], ambientSounds: [] };
}

function saveAppData(data: AppData) {
  localStorage.setItem('youtube-notes-data', JSON.stringify(data));
}

// Annotation Item Component
interface AnnotationItemProps {
  annotation: Annotation;
  onPlay: (timestamp: number) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Annotation>) => void;
}

function AnnotationItem({ annotation, onPlay, onDelete, onUpdate }: AnnotationItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(annotation.title);
  const [editDescription, setEditDescription] = useState(annotation.description || '');
  const [editTimestamp, setEditTimestamp] = useState(formatTime(annotation.timestamp));

  const hasDescription = annotation.description && annotation.description.trim().length > 0;
  const canExpand = hasDescription;

  // Parse time string (m:ss or mm:ss) to seconds
  const parseTime = (timeStr: string): number | null => {
    const match = timeStr.trim().match(/^(\d+):(\d{1,2})$/);
    if (match) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      if (secs < 60) {
        return mins * 60 + secs;
      }
    }
    return null;
  };

  const handleSave = () => {
    const newTimestamp = parseTime(editTimestamp);
    onUpdate(annotation.id, {
      title: (editTitle || '').trim() || annotation.title,
      description: (editDescription || '').trim() || undefined,
      ...(newTimestamp !== null ? { timestamp: newTimestamp } : {}),
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(annotation.title);
    setEditDescription(annotation.description || '');
    setEditTimestamp(formatTime(annotation.timestamp));
    setIsEditing(false);
    setIsExpanded(false);
  };

  return (
    <div className={`annotation-item ${isExpanded ? 'expanded' : ''}`}>
      <div
        className="annotation-header"
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
      >
        <button
          className="play-btn"
          onClick={(e) => {
            e.stopPropagation();
            onPlay(annotation.timestamp);
          }}
          title="Play from this timestamp"
        >
          ▶
        </button>
        <span className="timestamp">{formatTime(annotation.timestamp)}</span>
        <span className="note-title">{annotation.title}</span>
        <button
          className="edit-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
            setIsExpanded(true);
          }}
          title="Edit annotation"
        >
          ✎
        </button>
        {hasDescription && (
          <span className={`expand-indicator ${isExpanded ? 'expanded' : ''}`} title="Has description - click to expand">
            ▼
          </span>
        )}
      </div>

      {(isExpanded || isEditing) && (
        <div className="annotation-details">
          {isEditing ? (
            <div className="edit-form">
              <div className="edit-row">
                <input
                  type="text"
                  value={editTimestamp}
                  onChange={(e) => setEditTimestamp(e.target.value)}
                  placeholder="0:00"
                  className="edit-timestamp-input"
                  title="Timestamp (m:ss)"
                />
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Title"
                  className="edit-title-input"
                />
              </div>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description (optional)"
                className="edit-description-input"
              />
              <div className="edit-actions">
                <button onClick={handleSave} className="save-btn">Save</button>
                <button onClick={handleCancel} className="cancel-btn">Cancel</button>
                <button
                  onClick={() => onDelete(annotation.id)}
                  className="delete-btn-edit"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            hasDescription && (
              <p className="annotation-description">{annotation.description}</p>
            )
          )}
        </div>
      )}
    </div>
  );
}

// Sidebar Folder Component
interface FolderItemProps {
  folder: Folder;
  folders: Folder[];
  videos: SavedVideo[];
  selectedVideoId: string | null;
  selectedFolderId: string | null;
  onSelectFolder: (id: string) => void;
  onSelectVideo: (video: SavedVideo) => void;
  onToggleExpand: (id: string) => void;
  onCreateSubfolder: (parentId: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteVideo: (id: string) => void;
  onDragStart: (item: DragItem) => void;
  onDragEnd: () => void;
  onDrop: (targetFolderId: string | null) => void;
  draggedItem: DragItem | null;
  depth: number;
}

function FolderItem({
  folder,
  folders,
  videos,
  selectedVideoId,
  selectedFolderId,
  onSelectFolder,
  onSelectVideo,
  onToggleExpand,
  onCreateSubfolder,
  onDeleteFolder,
  onRenameFolder,
  onDeleteVideo,
  onDragStart,
  onDragEnd,
  onDrop,
  draggedItem,
  depth,
}: FolderItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(folder.name);
  const [showActions, setShowActions] = useState(false);
  const [showNewSubfolderInput, setShowNewSubfolderInput] = useState(false);
  const [newSubfolderName, setNewSubfolderName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const childFolders = folders.filter(f => f.parentId === folder.id);
  const folderVideos = videos.filter(v => v.id.startsWith(folder.id + '/'));

  const handleRename = () => {
    if (newName.trim()) {
      onRenameFolder(folder.id, newName.trim());
    }
    setIsRenaming(false);
  };

  // Check if this folder is a descendant of the dragged folder (to prevent dropping into itself)
  const isDescendantOfDragged = (folderId: string): boolean => {
    if (!draggedItem || draggedItem.type !== 'folder') return false;
    let current = folders.find(f => f.id === folderId);
    while (current) {
      if (current.id === draggedItem.id) return true;
      current = folders.find(f => f.id === current?.parentId);
    }
    return false;
  };

  const canDropHere = draggedItem &&
    draggedItem.id !== folder.id &&
    !isDescendantOfDragged(folder.id);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (canDropHere) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (canDropHere) {
      onDrop(folder.id);
    }
  };

  return (
    <div className="folder-item">
      <div
        className={`folder-row ${isDragOver ? 'drag-over' : ''} ${draggedItem?.type === 'folder' && draggedItem.id === folder.id ? 'dragging' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart({ type: 'folder', id: folder.id });
        }}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          onSelectFolder(folder.id);
          if (childFolders.length > 0 || folderVideos.length > 0) {
            onToggleExpand(folder.id);
          }
        }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <span className={`folder-arrow ${folder.isExpanded ? 'expanded' : ''}`}>
          {(childFolders.length > 0 || folderVideos.length > 0) ? '▶' : ''}
        </span>
        <span className="folder-icon">📁</span>
        {isRenaming ? (
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            className="folder-rename-input"
          />
        ) : (
          <span className="folder-name">{folder.name}</span>
        )}
        {showActions && !isRenaming && (
          <div className="folder-actions">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowNewSubfolderInput(true);
                onToggleExpand(folder.id);
              }}
              title="Add subfolder"
            >
              +
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsRenaming(true);
                setNewName(folder.name);
              }}
              title="Rename"
            >
              ✎
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder(folder.id);
              }}
              title="Delete"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {(folder.isExpanded || showNewSubfolderInput) && (
        <div className="folder-children">
          {showNewSubfolderInput && (
            <div className="new-subfolder-input" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
              <input
                type="text"
                placeholder="Subfolder name..."
                value={newSubfolderName}
                onChange={(e) => setNewSubfolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSubfolderName.trim()) {
                    onCreateSubfolder(folder.id, newSubfolderName.trim());
                    setNewSubfolderName('');
                    setShowNewSubfolderInput(false);
                  }
                  if (e.key === 'Escape') {
                    setShowNewSubfolderInput(false);
                    setNewSubfolderName('');
                  }
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (newSubfolderName.trim()) {
                    onCreateSubfolder(folder.id, newSubfolderName.trim());
                    setNewSubfolderName('');
                  }
                  setShowNewSubfolderInput(false);
                }}
              >
                ✓
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowNewSubfolderInput(false);
                  setNewSubfolderName('');
                }}
              >
                ×
              </button>
            </div>
          )}
          {childFolders.map(child => (
            <FolderItem
              key={child.id}
              folder={child}
              folders={folders}
              videos={videos}
              selectedVideoId={selectedVideoId}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onSelectVideo={onSelectVideo}
              onToggleExpand={onToggleExpand}
              onCreateSubfolder={onCreateSubfolder}
              onDeleteFolder={onDeleteFolder}
              onRenameFolder={onRenameFolder}
              onDeleteVideo={onDeleteVideo}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              draggedItem={draggedItem}
              depth={depth + 1}
            />
          ))}
          {folderVideos.map(video => (
            <VideoItem
              key={video.id}
              video={video}
              isSelected={selectedVideoId === video.id}
              onSelect={() => onSelectVideo(video)}
              onDelete={() => onDeleteVideo(video.id)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              draggedItem={draggedItem}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Video Item in sidebar
interface VideoItemProps {
  video: SavedVideo;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDragStart: (item: DragItem) => void;
  onDragEnd: () => void;
  draggedItem: DragItem | null;
  depth: number;
}

function VideoItem({ video, isSelected, onSelect, onDelete, onDragStart, onDragEnd, draggedItem, depth }: VideoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const isDragging = draggedItem?.type === 'video' && draggedItem.id === video.id;

  return (
    <div
      className={`video-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ paddingLeft: `${depth * 16 + 24}px` }}
      draggable={!isEditing}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart({ type: 'video', id: video.id });
      }}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => !isEditing && setShowActions(false)}
    >
      <span className="video-icon">🎬</span>
      <span className="video-name">{video.title}</span>
      {showActions && !isEditing && (
        <button
          className="video-edit-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          title="Edit video"
        >
          ✎
        </button>
      )}
      {isEditing && (
        <>
          <button
            className="video-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete video"
          >
            ×
          </button>
          <button
            className="video-done-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(false);
              setShowActions(false);
            }}
            title="Done"
          >
            ✓
          </button>
        </>
      )}
    </div>
  );
}

// Playlist Sidebar Item Component
interface PlaylistSidebarItemProps {
  playlist: Playlist;
  isActive: boolean;
  onPlay: () => void;
  onDelete: () => void;
}

function PlaylistSidebarItem({ playlist, isActive, onPlay, onDelete }: PlaylistSidebarItemProps) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className={`playlist-sidebar-item ${isActive ? 'active' : ''}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="playlist-sidebar-main" onClick={onPlay}>
        <span className="playlist-icon">🎵</span>
        <div className="playlist-info">
          <span className="playlist-name">{playlist.name}</span>
          <span className="playlist-count">{playlist.items.length} video{playlist.items.length !== 1 ? 's' : ''}</span>
        </div>
        {playlist.startRandom && <span className="shuffle-indicator" title="Random/shuffle enabled">🔀</span>}
        {playlist.loop && <span className="loop-indicator" title="Loop enabled">🔁</span>}
      </div>
      {showActions && (
        <div className="playlist-actions">
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete playlist">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

// Main App Component
const ASPECT_RATIOS = [
  { label: '16:9', value: 16 / 9 },
  { label: '4:3', value: 4 / 3 },
  { label: '1:1', value: 1 },
  { label: '21:9', value: 21 / 9 },
];

function App() {
  const [appData, setAppData] = useState<AppData>(loadAppData);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [currentVideo, setCurrentVideo] = useState<SavedVideo | null>(null);

  const [videoUrl, setVideoUrl] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const [localVideoName, setLocalVideoName] = useState<string>('');
  const [generalNotes, setGeneralNotes] = useState('');
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editNotesValue, setEditNotesValue] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [newAnnotation, setNewAnnotation] = useState('');
  const [videoTitle, setVideoTitle] = useState('');

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveFolderId, setSaveFolderId] = useState<string | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInSaveDialog, setShowNewFolderInSaveDialog] = useState(false);
  const [newFolderNameInSaveDialog, setNewFolderNameInSaveDialog] = useState('');

  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [customRatio, setCustomRatio] = useState('16:9');
  const [playerHeight, setPlayerHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const videoSectionRef = useRef<HTMLDivElement>(null);

  // Panel resize state
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [notesWidth, setNotesWidth] = useState(400);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingNotes, setIsResizingNotes] = useState(false);

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null);
  const [rootDropZoneActive, setRootDropZoneActive] = useState(false);

  // Import/Export state
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // Playlist state
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [isPlaylistMode, setIsPlaylistMode] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [playlistName, setPlaylistName] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'annotations' | 'playlists'>('annotations');
  const [fetchedVideoTitle, setFetchedVideoTitle] = useState<string>('');

  // Audio Mixer state
  const [mainVideoVolume, setMainVideoVolume] = useState(100);
  const [mainVideoMuted, setMainVideoMuted] = useState(false);
  const [ambientVideoId, setAmbientVideoId] = useState<string | null>(null); // Initial ID for creating player
  const [currentAmbientId, setCurrentAmbientId] = useState<string | null>(null); // Current playing ID for UI
  const [ambientVideoTitle, setAmbientVideoTitle] = useState('');
  const [ambientVideoUrl, setAmbientVideoUrl] = useState('');
  const [ambientVolume, setAmbientVolume] = useState(50);
  const [ambientMuted, setAmbientMuted] = useState(false);
  const [ambientPlaying, setAmbientPlaying] = useState(true);
  const [showAmbientUrlInput, setShowAmbientUrlInput] = useState(false);
  const ambientPlayerRef = useRef<YouTubePlayer | null>(null);

  const [pendingImportData, setPendingImportData] = useState<AppData | null>(null);
  const [pendingImportVideo, setPendingImportVideo] = useState<SavedVideo | null>(null);
  const [importTargetFolderId, setImportTargetFolderId] = useState<string | null>(null);
  const [localVideosToLink, setLocalVideosToLink] = useState<SavedVideo[]>([]);
  const [currentLinkingVideo, setCurrentLinkingVideo] = useState<SavedVideo | null>(null);
  const [linkedLocalVideos, setLinkedLocalVideos] = useState<Map<string, string>>(new Map());

  const playerRef = useRef<YouTubePlayer | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const linkVideoInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRandomSeek = useRef<boolean>(false); // Flag to seek to random time after video loads

  const handleCustomRatioChange = (value: string) => {
    setCustomRatio(value);
    const match = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (match) {
      const w = parseFloat(match[1]);
      const h = parseFloat(match[2]);
      if (w > 0 && h > 0) {
        setAspectRatio(w / h);
        setPlayerHeight(null);
      }
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = playerHeight || (videoSectionRef.current?.querySelector('.youtube-player, .video-placeholder')?.getBoundingClientRect().height || 400);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(200, Math.min(800, startHeight + deltaY));
      setPlayerHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Sidebar resize handler
  const handleSidebarResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(200, Math.min(500, startWidth + deltaX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Notes panel resize handler
  const handleNotesResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingNotes(true);
    const startX = e.clientX;
    const startWidth = notesWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX; // Reversed because dragging left increases width
      const newWidth = Math.max(300, Math.min(600, startWidth + deltaX));
      setNotesWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingNotes(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Save app data whenever it changes
  useEffect(() => {
    saveAppData(appData);
  }, [appData]);

  // Root level folders
  const rootFolders = appData.folders.filter(f => f.parentId === null);

  // Folder operations
  const createFolder = (parentId: string | null, name: string) => {
    const newFolder: Folder = {
      id: Date.now().toString(),
      name,
      parentId,
      isExpanded: false,
    };
    setAppData(prev => ({
      ...prev,
      folders: [...prev.folders, newFolder],
    }));
    setSelectedFolderId(newFolder.id);
  };

  const toggleFolderExpand = (id: string) => {
    setAppData(prev => ({
      ...prev,
      folders: prev.folders.map(f =>
        f.id === id ? { ...f, isExpanded: !f.isExpanded } : f
      ),
    }));
  };

  const deleteFolder = (id: string) => {
    // Get all descendant folder IDs
    const getDescendantIds = (folderId: string): string[] => {
      const children = appData.folders.filter(f => f.parentId === folderId);
      return [folderId, ...children.flatMap(c => getDescendantIds(c.id))];
    };
    const idsToDelete = getDescendantIds(id);

    setAppData(prev => ({
      ...prev,
      folders: prev.folders.filter(f => !idsToDelete.includes(f.id)),
      videos: prev.videos.filter(v => !idsToDelete.some(fid => v.id.startsWith(fid + '/'))),
    }));

    if (selectedFolderId && idsToDelete.includes(selectedFolderId)) {
      setSelectedFolderId(null);
    }
  };

  const renameFolder = (id: string, name: string) => {
    setAppData(prev => ({
      ...prev,
      folders: prev.folders.map(f =>
        f.id === id ? { ...f, name } : f
      ),
    }));
  };

  // Move folder to new parent
  const moveFolder = (folderId: string, newParentId: string | null) => {
    // Don't move if same parent
    const folder = appData.folders.find(f => f.id === folderId);
    if (!folder || folder.parentId === newParentId) return;

    // Don't allow moving a folder into itself or its descendants
    const getDescendantIds = (id: string): string[] => {
      const children = appData.folders.filter(f => f.parentId === id);
      return [id, ...children.flatMap(c => getDescendantIds(c.id))];
    };
    if (newParentId && getDescendantIds(folderId).includes(newParentId)) return;

    setAppData(prev => ({
      ...prev,
      folders: prev.folders.map(f =>
        f.id === folderId ? { ...f, parentId: newParentId } : f
      ),
    }));
  };

  // Move video to new folder
  const moveVideo = (videoId: string, newFolderId: string) => {
    const video = appData.videos.find(v => v.id === videoId);
    if (!video) return;

    // Extract the unique part of the video id (timestamp)
    const parts = video.id.split('/');
    const uniquePart = parts[parts.length - 1];
    const newVideoId = `${newFolderId}/${uniquePart}`;

    // Don't move if same folder
    if (video.id === newVideoId) return;

    setAppData(prev => ({
      ...prev,
      videos: prev.videos.map(v =>
        v.id === videoId ? { ...v, id: newVideoId } : v
      ),
    }));

    // Update current video if it's the one being moved
    if (currentVideo?.id === videoId) {
      setCurrentVideo(prev => prev ? { ...prev, id: newVideoId } : null);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (item: DragItem) => {
    setDraggedItem(item);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setRootDropZoneActive(false);
  };

  const handleDrop = (targetFolderId: string | null) => {
    if (!draggedItem) return;

    if (draggedItem.type === 'folder') {
      moveFolder(draggedItem.id, targetFolderId);
    } else if (draggedItem.type === 'video' && targetFolderId) {
      moveVideo(draggedItem.id, targetFolderId);
    }

    setDraggedItem(null);
    setRootDropZoneActive(false);
  };

  // Video operations
  const saveVideo = () => {
    if ((!videoId && !localVideoUrl) || !saveTitle.trim()) return;

    let targetFolderId = saveFolderId;

    // If no folder selected, create a default "Saved Videos" folder
    if (!targetFolderId) {
      const newFolder: Folder = {
        id: Date.now().toString(),
        name: 'Saved Videos',
        parentId: null,
        isExpanded: true,
      };
      setAppData(prev => ({
        ...prev,
        folders: [...prev.folders, newFolder],
      }));
      targetFolderId = newFolder.id;
    }

    const savedVideo: SavedVideo = {
      id: `${targetFolderId}/${Date.now()}`,
      videoId: videoId || '',
      title: saveTitle.trim(),
      url: localVideoUrl || videoUrl,
      generalNotes,
      annotations,
      createdAt: Date.now(),
      isLocalFile: !!localVideoUrl,
      localFileName: localVideoName || undefined,
    };

    setAppData(prev => ({
      ...prev,
      videos: [...prev.videos, savedVideo],
    }));

    setCurrentVideo(savedVideo);
    setSelectedFolderId(targetFolderId);
    setShowSaveDialog(false);
    setSaveTitle('');
    setSaveFolderId(null);
    setShowNewFolderInSaveDialog(false);
    setNewFolderNameInSaveDialog('');
  };

  // Open save dialog and initialize folder selection
  const openSaveDialog = () => {
    // If editing existing video, pre-fill the title and folder
    if (currentVideo) {
      setSaveTitle(currentVideo.title);
      // Extract folder ID from video ID (format: folderId/timestamp)
      const folderIdFromVideo = currentVideo.id.split('/').slice(0, -1).join('/');
      setSaveFolderId(folderIdFromVideo || selectedFolderId || (appData.folders.length > 0 ? appData.folders[0].id : null));
    } else {
      // Use fetched YouTube title, local file name, or empty string
      setSaveTitle(fetchedVideoTitle || localVideoName || '');
      setSaveFolderId(selectedFolderId || (appData.folders.length > 0 ? appData.folders[0].id : null));
    }
    setShowSaveDialog(true);
  };

  // Update existing video in place
  const updateExistingVideo = () => {
    if (!currentVideo || !saveTitle.trim()) return;

    let targetFolderId = saveFolderId;

    // If no folder selected, create a default folder
    if (!targetFolderId) {
      const newFolder: Folder = {
        id: Date.now().toString(),
        name: 'Saved Videos',
        parentId: null,
        isExpanded: true,
      };
      setAppData(prev => ({
        ...prev,
        folders: [...prev.folders, newFolder],
      }));
      targetFolderId = newFolder.id;
    }

    // Check if folder changed
    const currentFolderId = currentVideo.id.split('/').slice(0, -1).join('/');
    const folderChanged = currentFolderId !== targetFolderId;

    // Create updated video
    const updatedVideo: SavedVideo = {
      ...currentVideo,
      id: folderChanged ? `${targetFolderId}/${Date.now()}` : currentVideo.id,
      title: saveTitle.trim(),
      generalNotes,
      annotations,
    };

    setAppData(prev => ({
      ...prev,
      videos: prev.videos.map(v =>
        v.id === currentVideo.id ? updatedVideo : v
      ),
    }));

    setCurrentVideo(updatedVideo);
    if (folderChanged) {
      setSelectedFolderId(targetFolderId);
    }
    setShowSaveDialog(false);
    setSaveTitle('');
    setSaveFolderId(null);
    setShowNewFolderInSaveDialog(false);
    setNewFolderNameInSaveDialog('');
  };

  // Create new folder from save dialog
  const createFolderInSaveDialog = () => {
    if (!newFolderNameInSaveDialog.trim()) return;

    const newFolder: Folder = {
      id: Date.now().toString(),
      name: newFolderNameInSaveDialog.trim(),
      parentId: null,
      isExpanded: true,
    };
    setAppData(prev => ({
      ...prev,
      folders: [...prev.folders, newFolder],
    }));
    setSaveFolderId(newFolder.id);
    setShowNewFolderInSaveDialog(false);
    setNewFolderNameInSaveDialog('');
  };

  const updateCurrentVideo = () => {
    if (!currentVideo) return;

    setAppData(prev => ({
      ...prev,
      videos: prev.videos.map(v =>
        v.id === currentVideo.id
          ? { ...v, generalNotes, annotations }
          : v
      ),
    }));
  };

  const loadVideo = (video: SavedVideo) => {
    // Exit playlist mode when loading an annotation
    setIsPlaylistMode(false);
    setActivePlaylist(null);
    setPlaylistIndex(0);

    setCurrentVideo(video);
    setGeneralNotes(video.generalNotes);
    setAnnotations(video.annotations);
    setVideoTitle(video.title);

    if (video.isLocalFile) {
      // Local video - check if URL is a blob URL (already linked) or needs linking
      if (video.url && video.url.startsWith('blob:')) {
        setLocalVideoUrl(video.url);
        setLocalVideoName(video.localFileName || 'Local Video');
        setVideoId(null);
        setVideoUrl('');
      } else {
        // Local video needs to be re-linked - prompt user
        setLocalVideoUrl(null);
        setLocalVideoName(video.localFileName || '');
        setVideoId(null);
        setVideoUrl('');
        // Show prompt to link the video
        setLocalVideosToLink([video]);
        setCurrentLinkingVideo(video);
        setLinkedLocalVideos(new Map());
        setShowImportModal(true);
      }
    } else {
      // YouTube video
      setVideoUrl(video.url);
      setVideoId(video.videoId);
      setLocalVideoUrl(null);
      setLocalVideoName('');
    }
  };

  const deleteVideo = (id: string) => {
    setAppData(prev => ({
      ...prev,
      videos: prev.videos.filter(v => v.id !== id),
    }));
    if (currentVideo?.id === id) {
      setCurrentVideo(null);
      setVideoId(null);
      setVideoUrl('');
      setGeneralNotes('');
      setAnnotations([]);
    }
  };

  // Clear everything and start new
  const handleNew = () => {
    // Revoke local video URL to prevent memory leaks
    if (localVideoUrl) {
      URL.revokeObjectURL(localVideoUrl);
    }
    setVideoId(null);
    setVideoUrl('');
    setLocalVideoUrl(null);
    setLocalVideoName('');
    setGeneralNotes('');
    setAnnotations([]);
    setCurrentVideo(null);
    // Exit playlist mode
    setIsPlaylistMode(false);
    setActivePlaylist(null);
    setPlaylistIndex(0);
  };

  // Playlist operations
  const createPlaylist = (name: string) => {
    const newPlaylist: Playlist = {
      id: Date.now().toString(),
      name: name.trim() || 'Untitled Playlist',
      items: [],
      createdAt: Date.now(),
      loop: true,
    };
    setAppData(prev => ({
      ...prev,
      playlists: [...prev.playlists, newPlaylist],
    }));
    return newPlaylist;
  };

  const deletePlaylist = (id: string) => {
    setAppData(prev => ({
      ...prev,
      playlists: prev.playlists.filter(p => p.id !== id),
    }));
    if (activePlaylist?.id === id) {
      setActivePlaylist(null);
      setIsPlaylistMode(false);
      setPlaylistIndex(0);
    }
  };

  const renamePlaylist = (id: string, name: string) => {
    setAppData(prev => ({
      ...prev,
      playlists: prev.playlists.map(p =>
        p.id === id ? { ...p, name: name.trim() || p.name } : p
      ),
    }));
    if (activePlaylist?.id === id) {
      setActivePlaylist(prev => prev ? { ...prev, name: name.trim() || prev.name } : null);
    }
  };

  const togglePlaylistLoop = (id: string) => {
    setAppData(prev => ({
      ...prev,
      playlists: prev.playlists.map(p =>
        p.id === id ? { ...p, loop: !p.loop } : p
      ),
    }));
    if (activePlaylist?.id === id) {
      setActivePlaylist(prev => prev ? { ...prev, loop: !prev.loop } : null);
    }
  };

  const addVideoToPlaylist = (playlistId: string, item: PlaylistItem) => {
    setAppData(prev => ({
      ...prev,
      playlists: prev.playlists.map(p =>
        p.id === playlistId ? { ...p, items: [...p.items, item] } : p
      ),
    }));
    if (activePlaylist?.id === playlistId) {
      setActivePlaylist(prev => prev ? { ...prev, items: [...prev.items, item] } : null);
    }
  };

  // Add YouTube video to playlist with auto-fetched title
  const addYouTubeToPlaylist = async (playlistId: string, youtubeUrl: string) => {
    const id = extractVideoId(youtubeUrl);
    if (!id) return;

    // Add immediately with placeholder title
    const itemId = Date.now().toString();
    const item: PlaylistItem = {
      id: itemId,
      videoId: id,
      url: youtubeUrl,
      title: 'Loading...',
    };
    addVideoToPlaylist(playlistId, item);

    // Fetch title and update
    const title = await fetchYouTubeTitle(id);
    if (title) {
      // Update the item with the fetched title
      setAppData(prev => ({
        ...prev,
        playlists: prev.playlists.map(p =>
          p.id === playlistId
            ? { ...p, items: p.items.map(i => i.id === itemId ? { ...i, title } : i) }
            : p
        ),
      }));
      if (activePlaylist?.id === playlistId) {
        setActivePlaylist(prev =>
          prev ? { ...prev, items: prev.items.map(i => i.id === itemId ? { ...i, title } : i) } : null
        );
      }
    } else {
      // If fetch failed, use a default title
      const playlist = appData.playlists.find(p => p.id === playlistId);
      const defaultTitle = `Video ${playlist ? playlist.items.length : 1}`;
      setAppData(prev => ({
        ...prev,
        playlists: prev.playlists.map(p =>
          p.id === playlistId
            ? { ...p, items: p.items.map(i => i.id === itemId ? { ...i, title: defaultTitle } : i) }
            : p
        ),
      }));
      if (activePlaylist?.id === playlistId) {
        setActivePlaylist(prev =>
          prev ? { ...prev, items: prev.items.map(i => i.id === itemId ? { ...i, title: defaultTitle } : i) } : null
        );
      }
    }
  };

  const removeVideoFromPlaylist = (playlistId: string, itemId: string) => {
    setAppData(prev => ({
      ...prev,
      playlists: prev.playlists.map(p =>
        p.id === playlistId ? { ...p, items: p.items.filter(i => i.id !== itemId) } : p
      ),
    }));
    if (activePlaylist?.id === playlistId) {
      setActivePlaylist(prev => {
        if (!prev) return null;
        const newItems = prev.items.filter(i => i.id !== itemId);
        // Adjust index if needed
        if (playlistIndex >= newItems.length && newItems.length > 0) {
          setPlaylistIndex(newItems.length - 1);
        }
        return { ...prev, items: newItems };
      });
    }
  };

  const reorderPlaylistItem = (playlistId: string, fromIndex: number, toIndex: number) => {
    setAppData(prev => ({
      ...prev,
      playlists: prev.playlists.map(p => {
        if (p.id !== playlistId) return p;
        const items = [...p.items];
        const [removed] = items.splice(fromIndex, 1);
        items.splice(toIndex, 0, removed);
        return { ...p, items };
      }),
    }));
    if (activePlaylist?.id === playlistId) {
      setActivePlaylist(prev => {
        if (!prev) return null;
        const items = [...prev.items];
        const [removed] = items.splice(fromIndex, 1);
        items.splice(toIndex, 0, removed);
        return { ...prev, items };
      });
    }
  };

  // Play a playlist (respects startRandom setting unless startIndex is explicitly provided)
  const playPlaylist = (playlist: Playlist, startIndex?: number) => {
    // Get the latest version of the playlist from appData in case it was updated
    const currentPlaylist = appData.playlists.find(p => p.id === playlist.id) || playlist;

    let actualStartIndex = startIndex ?? 0;

    // If no startIndex provided and playlist has startRandom enabled, pick random
    if (startIndex === undefined && currentPlaylist.startRandom && currentPlaylist.items.length > 0) {
      actualStartIndex = Math.floor(Math.random() * currentPlaylist.items.length);
    }

    // Reset player state to force fresh load when switching playlists
    setVideoId(null);
    setVideoUrl('');
    setLocalVideoUrl(null);
    setLocalVideoName('');
    playerRef.current = null;

    setActivePlaylist(currentPlaylist);
    setPlaylistIndex(actualStartIndex);
    setIsPlaylistMode(true);

    // Auto-play first ambient sound if none is currently playing
    if (!currentAmbientId && appData.ambientSounds && appData.ambientSounds.length > 0) {
      const firstAmbient = appData.ambientSounds[0];
      setAmbientVideoId(firstAmbient.videoId);
      setCurrentAmbientId(firstAmbient.videoId);
      setAmbientVideoTitle(firstAmbient.title);
      setAmbientPlaying(true);
    }

    // Load the video at the start index after a tick to ensure state is cleared
    if (currentPlaylist.items.length > 0) {
      const item = currentPlaylist.items[actualStartIndex];
      // Set random seek flag if playlist has randomTime enabled
      if (currentPlaylist.randomTime) {
        pendingRandomSeek.current = true;
      }
      // Use setTimeout to ensure state clears before loading new video
      setTimeout(() => {
        setVideoId(item.videoId);
        setVideoUrl(item.url);
        setCurrentVideo(null);
        setGeneralNotes('');
        setAnnotations([]);
      }, 0);
    } else {
      // Clear any existing video for empty playlists
      setCurrentVideo(null);
      setGeneralNotes('');
      setAnnotations([]);
    }
  };

  // Toggle startRandom setting for a playlist
  const togglePlaylistStartRandom = (playlistId: string) => {
    setAppData(prev => ({
      ...prev,
      playlists: prev.playlists.map(p =>
        p.id === playlistId ? { ...p, startRandom: !p.startRandom } : p
      ),
    }));
    // Update active playlist if it's the one being modified
    if (activePlaylist?.id === playlistId) {
      setActivePlaylist(prev => prev ? { ...prev, startRandom: !prev.startRandom } : null);
    }
  };

  const togglePlaylistRandomTime = (playlistId: string) => {
    setAppData(prev => ({
      ...prev,
      playlists: prev.playlists.map(p =>
        p.id === playlistId ? { ...p, randomTime: !p.randomTime } : p
      ),
    }));
    // Update active playlist if it's the one being modified
    if (activePlaylist?.id === playlistId) {
      setActivePlaylist(prev => prev ? { ...prev, randomTime: !prev.randomTime } : null);
    }
  };

  // Load a playlist item into the player
  const loadPlaylistItem = (item: PlaylistItem) => {
    // Clear annotation state
    setCurrentVideo(null);
    setGeneralNotes('');
    setAnnotations([]);

    // Set flag for random time seek if enabled
    const shouldRandomSeek = activePlaylist?.randomTime;
    if (shouldRandomSeek) {
      pendingRandomSeek.current = true;
    }

    if (item.isLocalFile) {
      setLocalVideoUrl(item.url);
      setLocalVideoName(item.localFileName || item.title);
      setVideoId(null);
      setVideoUrl('');
    } else {
      // If we already have a player instance and a video is loaded, use loadVideoById
      // and DON'T update videoId state (which would change the key and remount)
      if (playerRef.current && videoId) {
        playerRef.current.loadVideoById(item.videoId);
        // Only update URL for reference, not videoId (keeps component stable)
        setVideoUrl(item.url);
        setLocalVideoUrl(null);
        setLocalVideoName('');

        // Handle random time seek for loadVideoById case
        if (shouldRandomSeek) {
          setTimeout(() => {
            if (playerRef.current) {
              const duration = playerRef.current.getDuration();
              if (duration > 0) {
                const randomTime = Math.random() * duration * 0.8;
                playerRef.current.seekTo(randomTime, true);
              }
              pendingRandomSeek.current = false;
            }
          }, 1000); // Wait for video to load
        }
      } else {
        // No player yet - set state to create component (handlePlayerReady will handle seek)
        setVideoId(item.videoId);
        setVideoUrl(item.url);
        setLocalVideoUrl(null);
        setLocalVideoName('');
      }
    }
  };

  // Navigate playlist
  const playlistNext = () => {
    if (!activePlaylist || activePlaylist.items.length === 0) return;

    let nextIndex: number;

    if (activePlaylist.startRandom) {
      // Random mode - pick a random video (different from current if possible)
      if (activePlaylist.items.length === 1) {
        nextIndex = 0;
      } else {
        do {
          nextIndex = Math.floor(Math.random() * activePlaylist.items.length);
        } while (nextIndex === playlistIndex);
      }
    } else {
      // Sequential mode
      nextIndex = playlistIndex + 1;
      if (nextIndex >= activePlaylist.items.length) {
        if (activePlaylist.loop) {
          nextIndex = 0;
        } else {
          return; // End of playlist
        }
      }
    }

    setPlaylistIndex(nextIndex);
    loadPlaylistItem(activePlaylist.items[nextIndex]);
  };

  const playlistPrev = () => {
    if (!activePlaylist || activePlaylist.items.length === 0) return;

    let prevIndex = playlistIndex - 1;
    if (prevIndex < 0) {
      if (activePlaylist.loop) {
        prevIndex = activePlaylist.items.length - 1;
      } else {
        return; // Start of playlist
      }
    }
    setPlaylistIndex(prevIndex);
    loadPlaylistItem(activePlaylist.items[prevIndex]);
  };

  const playlistGoTo = (index: number) => {
    if (!activePlaylist || index < 0 || index >= activePlaylist.items.length) return;
    setPlaylistIndex(index);
    loadPlaylistItem(activePlaylist.items[index]);
  };

  const exitPlaylistMode = () => {
    setIsPlaylistMode(false);
    setActivePlaylist(null);
    setPlaylistIndex(0);
  };

  // Add current video to a playlist
  const addCurrentVideoToPlaylist = (playlistId: string) => {
    if (!videoId && !localVideoUrl) return;

    const item: PlaylistItem = {
      id: Date.now().toString(),
      videoId: videoId || '',
      url: localVideoUrl || videoUrl,
      title: localVideoName || currentVideo?.title || 'Untitled Video',
      isLocalFile: !!localVideoUrl,
      localFileName: localVideoName || undefined,
    };

    addVideoToPlaylist(playlistId, item);
  };

  // Open playlist modal for creating/editing
  const openPlaylistModal = (playlist?: Playlist) => {
    if (playlist) {
      setEditingPlaylist(playlist);
      setPlaylistName(playlist.name);
    } else {
      setEditingPlaylist(null);
      setPlaylistName('');
    }
    setShowPlaylistModal(true);
  };

  const closePlaylistModal = () => {
    setShowPlaylistModal(false);
    setEditingPlaylist(null);
    setPlaylistName('');
  };

  const savePlaylistModal = () => {
    if (editingPlaylist) {
      renamePlaylist(editingPlaylist.id, playlistName);
    } else {
      createPlaylist(playlistName);
    }
    closePlaylistModal();
  };

  // Audio Mixer functions - Main video volume control
  const updateMainVideoVolume = (volume: number) => {
    setMainVideoVolume(volume);
    if (playerRef.current) {
      playerRef.current.setVolume(volume);
    }
    if (localVideoRef.current) {
      localVideoRef.current.volume = volume / 100;
    }
  };

  const toggleMainVideoMute = () => {
    const newMuted = !mainVideoMuted;
    setMainVideoMuted(newMuted);
    if (playerRef.current) {
      if (newMuted) {
        playerRef.current.mute();
      } else {
        playerRef.current.unMute();
        playerRef.current.setVolume(mainVideoVolume);
      }
    }
    if (localVideoRef.current) {
      localVideoRef.current.muted = newMuted;
    }
  };

  // Ambient audio channel functions
  const setAmbientAudio = async (youtubeUrl: string) => {
    const id = extractVideoId(youtubeUrl);
    if (!id) {
      alert('Invalid YouTube URL');
      return;
    }

    // Fetch title
    let title = 'Loading...';
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`
      );
      if (response.ok) {
        const data = await response.json();
        title = data.title || 'Ambient Audio';
      }
    } catch (err) {
      console.error('Failed to fetch video title:', err);
      title = 'Ambient Audio';
    }

    // Use loadVideoById on existing player to avoid remounting component
    if (ambientPlayerRef.current && ambientVideoId) {
      ambientPlayerRef.current.loadVideoById(id);
      ambientPlayerRef.current.playVideo();
      // Update current ID for UI, but NOT ambientVideoId (keeps component stable)
      setCurrentAmbientId(id);
      setAmbientVideoTitle(title);
      setAmbientPlaying(true);
    } else {
      // No player yet, set both states to create component
      setAmbientVideoId(id);
      setCurrentAmbientId(id);
      setAmbientVideoTitle(title);
      setAmbientPlaying(true);
    }
  };

  const clearAmbientAudio = () => {
    setAmbientVideoId(null);
    setCurrentAmbientId(null);
    setAmbientVideoTitle('');
    setAmbientVideoUrl('');
    ambientPlayerRef.current = null;
  };

  const updateAmbientVolume = (volume: number) => {
    setAmbientVolume(volume);
    if (ambientPlayerRef.current) {
      ambientPlayerRef.current.setVolume(volume);
    }
  };

  const toggleAmbientMute = () => {
    const newMuted = !ambientMuted;
    setAmbientMuted(newMuted);
    if (ambientPlayerRef.current) {
      if (newMuted) {
        ambientPlayerRef.current.mute();
      } else {
        ambientPlayerRef.current.unMute();
        ambientPlayerRef.current.setVolume(ambientVolume);
      }
    }
  };

  const toggleAmbientPlay = () => {
    const newPlaying = !ambientPlaying;
    setAmbientPlaying(newPlaying);
    if (ambientPlayerRef.current) {
      if (newPlaying) {
        ambientPlayerRef.current.playVideo();
      } else {
        ambientPlayerRef.current.pauseVideo();
      }
    }
  };

  const handleAmbientPlayerReady = (event: YouTubeEvent) => {
    ambientPlayerRef.current = event.target;
    ambientPlayerRef.current.setVolume(ambientVolume);
    if (ambientMuted) {
      ambientPlayerRef.current.mute();
    }
    if (ambientPlaying) {
      ambientPlayerRef.current.playVideo();
    }
  };

  const handleAmbientPlayerEnd = () => {
    // Loop the ambient audio
    if (ambientPlayerRef.current) {
      ambientPlayerRef.current.seekTo(0);
      ambientPlayerRef.current.playVideo();
    }
  };

  // Save current ambient sound to library
  const saveCurrentAmbientSound = () => {
    if (!currentAmbientId || !ambientVideoTitle) return;

    // Check if already saved
    if (appData.ambientSounds?.some(s => s.videoId === currentAmbientId)) {
      alert('This ambient sound is already saved');
      return;
    }

    const newSound: AmbientSound = {
      id: Date.now().toString(),
      videoId: currentAmbientId,
      title: ambientVideoTitle,
    };

    setAppData(prev => ({
      ...prev,
      ambientSounds: [...(prev.ambientSounds || []), newSound],
    }));
  };

  // Load a saved ambient sound
  const loadAmbientSound = (sound: AmbientSound) => {
    // Use loadVideoById on existing player to avoid remounting component
    if (ambientPlayerRef.current && ambientVideoId) {
      ambientPlayerRef.current.loadVideoById(sound.videoId);
      ambientPlayerRef.current.playVideo();
      // Update current ID for UI, but NOT ambientVideoId (keeps component stable)
      setCurrentAmbientId(sound.videoId);
      setAmbientVideoTitle(sound.title);
      setAmbientPlaying(true);
    } else {
      // No player yet, set both states to create component
      setAmbientVideoId(sound.videoId);
      setCurrentAmbientId(sound.videoId);
      setAmbientVideoTitle(sound.title);
      setAmbientPlaying(true);
    }
  };

  // Edit a saved ambient sound's name
  const editAmbientSoundName = (id: string) => {
    const sound = appData.ambientSounds?.find(s => s.id === id);
    if (!sound) return;

    const newName = prompt('Enter custom name for this ambient sound:', sound.title);
    if (newName && newName.trim()) {
      setAppData(prev => ({
        ...prev,
        ambientSounds: (prev.ambientSounds || []).map(s =>
          s.id === id ? { ...s, title: newName.trim() } : s
        ),
      }));
      // Update current title if this is the playing sound
      if (currentAmbientId === sound.videoId) {
        setAmbientVideoTitle(newName.trim());
      }
    }
  };

  // Delete a saved ambient sound
  const deleteAmbientSound = (id: string) => {
    setAppData(prev => ({
      ...prev,
      ambientSounds: (prev.ambientSounds || []).filter(s => s.id !== id),
    }));
  };

  // Show export modal
  const handleExport = () => {
    setShowExportModal(true);
  };

  // Export current video as JSON file
  const exportCurrentVideo = () => {
    if (!videoId && !localVideoUrl) {
      alert('No video loaded to export');
      setShowExportModal(false);
      return;
    }

    const sessionVideo: SavedVideo = {
      id: `export_${Date.now()}`,
      videoId: videoId || '',
      title: localVideoName || 'Exported Video',
      url: localVideoUrl || videoUrl,
      generalNotes,
      annotations,
      createdAt: Date.now(),
      isLocalFile: !!localVideoUrl,
      localFileName: localVideoName || undefined,
    };

    const exportData = {
      video: sessionVideo,
      exportedAt: new Date().toISOString(),
      version: 2,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video-notes-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportModal(false);
  };

  // Export entire library as JSON file
  const exportEntireLibrary = () => {
    if (appData.folders.length === 0 && appData.videos.length === 0) {
      alert('Library is empty - nothing to export');
      setShowExportModal(false);
      return;
    }

    const exportData = {
      folders: appData.folders,
      videos: appData.videos,
      exportedAt: new Date().toISOString(),
      version: 1,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `library-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportModal(false);
  };

  // Share via URL - compress and encode data
  const handleShare = async () => {
    if (!videoId && !localVideoUrl) {
      alert('No video loaded to share');
      return;
    }

    // Create compact data format
    const compactData: CompactShareData = {
      v: videoId || '',
      t: localVideoName || 'Shared Video',
      g: generalNotes,
      a: annotations.map(ann => ({
        t: ann.timestamp,
        n: ann.title,
        ...(ann.description ? { d: ann.description } : {}),
      })),
      ...(localVideoUrl ? { l: true } : {}),
    };

    try {
      // Compress and encode
      const jsonStr = JSON.stringify(compactData);
      const compressed = pako.deflate(jsonStr);
      // Convert Uint8Array to base64
      let binaryStr = '';
      for (let i = 0; i < compressed.length; i++) {
        binaryStr += String.fromCharCode(compressed[i]);
      }
      const base64 = btoa(binaryStr);
      // Make URL-safe
      const urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const shareUrl = `${window.location.origin}${window.location.pathname}?d=${urlSafe}`;

      // Check URL length
      if (shareUrl.length > 8000) {
        alert(`URL is too long (${shareUrl.length} chars). Try reducing notes or annotations, or use Export instead.`);
        return;
      }

      // Copy to clipboard
      await navigator.clipboard.writeText(shareUrl);
      alert(`Share URL copied to clipboard! (${shareUrl.length} characters)\n\nAnyone with this link can view the video with your annotations.`);
    } catch (err) {
      console.error('Share error:', err);
      alert('Failed to create share URL. Try using Export instead.');
    }
  };

  // Share playlist via URL
  const handleSharePlaylist = async (playlist: Playlist) => {
    if (playlist.items.length === 0) {
      alert('Cannot share an empty playlist');
      return;
    }

    // Check for local videos
    const hasLocalVideos = playlist.items.some(item => item.isLocalFile);
    if (hasLocalVideos) {
      alert('Note: Local video files cannot be shared via URL. Recipients will need to link their own video files.');
    }

    // Create compact playlist data
    const compactPlaylist: CompactPlaylistData = {
      n: playlist.name,
      i: playlist.items.map(item => ({
        v: item.videoId,
        u: item.isLocalFile ? '' : item.url, // Don't include blob URLs
        t: item.title,
        ...(item.isLocalFile ? { l: true, f: item.localFileName } : {}),
      })),
      lp: playlist.loop,
      ...(playlist.startRandom ? { sr: true } : {}),
      ...(playlist.randomTime ? { rt: true } : {}),
      ...(appData.ambientSounds && appData.ambientSounds.length > 0 ? {
        as: appData.ambientSounds.map(sound => ({
          v: sound.videoId,
          t: sound.title,
        }))
      } : {}),
    };

    try {
      // Compress and encode
      const jsonStr = JSON.stringify(compactPlaylist);
      const compressed = pako.deflate(jsonStr);
      let binaryStr = '';
      for (let i = 0; i < compressed.length; i++) {
        binaryStr += String.fromCharCode(compressed[i]);
      }
      const base64 = btoa(binaryStr);
      const urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const shareUrl = `${window.location.origin}${window.location.pathname}?p=${urlSafe}`;

      if (shareUrl.length > 8000) {
        alert(`URL is too long (${shareUrl.length} chars). Try reducing the number of videos in the playlist.`);
        return;
      }

      await navigator.clipboard.writeText(shareUrl);
      alert(`Playlist share URL copied to clipboard! (${shareUrl.length} characters)\n\nAnyone with this link can play this playlist.`);
    } catch (err) {
      console.error('Share playlist error:', err);
      alert('Failed to create share URL.');
    }
  };

  // Load shared data from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const data = params.get('d');
    const playlistData = params.get('p');

    if (data) {
      try {
        // Decode URL-safe base64
        const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        const binaryStr = atob(padded);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        // Decompress
        const decompressed = pako.inflate(bytes, { to: 'string' });
        const compactData: CompactShareData = JSON.parse(decompressed);

        // Load the shared data
        setGeneralNotes(compactData.g);
        setAnnotations(compactData.a.map((ann, idx) => ({
          id: `shared_${idx}`,
          timestamp: ann.t,
          title: ann.n,
          description: ann.d,
        })));

        if (compactData.l) {
          // Local video - prompt user to select the file
          const sharedVideo: SavedVideo = {
            id: `shared_${Date.now()}`,
            videoId: '',
            title: compactData.t,
            url: '',
            generalNotes: compactData.g,
            annotations: compactData.a.map((ann, idx) => ({
              id: `shared_${idx}`,
              timestamp: ann.t,
              title: ann.n,
              description: ann.d,
            })),
            createdAt: Date.now(),
            isLocalFile: true,
            localFileName: compactData.t,
          };
          setLocalVideoName(compactData.t);
          setVideoId(null);
          setVideoUrl('');
          setLocalVideoUrl(null);
          // Show import modal to prompt for local video file
          setLocalVideosToLink([sharedVideo]);
          setCurrentLinkingVideo(sharedVideo);
          setLinkedLocalVideos(new Map());
          setShowImportModal(true);
        } else {
          // YouTube video
          setVideoId(compactData.v);
          setVideoUrl(`https://youtube.com/watch?v=${compactData.v}`);
          setLocalVideoUrl(null);
          setLocalVideoName('');
        }

        // Clear the URL parameter without reload
        window.history.replaceState({}, '', window.location.pathname);
      } catch (err) {
        console.error('Failed to load shared data:', err);
      }
    } else if (playlistData) {
      // Load shared playlist
      try {
        const base64 = playlistData.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        const binaryStr = atob(padded);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const decompressed = pako.inflate(bytes, { to: 'string' });
        const compactPlaylist: CompactPlaylistData = JSON.parse(decompressed);

        // Convert to Playlist format
        const sharedPlaylist: Playlist = {
          id: `shared_${Date.now()}`,
          name: compactPlaylist.n,
          items: compactPlaylist.i.map((item, idx) => ({
            id: `item_${idx}`,
            videoId: item.v,
            url: item.u,
            title: item.t,
            isLocalFile: item.l,
            localFileName: item.f,
          })),
          createdAt: Date.now(),
          loop: compactPlaylist.lp,
          startRandom: compactPlaylist.sr,
          randomTime: compactPlaylist.rt,
        };

        // Load ambient sounds if included
        if (compactPlaylist.as && compactPlaylist.as.length > 0) {
          const sharedAmbientSounds: AmbientSound[] = compactPlaylist.as.map((sound, idx) => ({
            id: `ambient_${Date.now()}_${idx}`,
            videoId: sound.v,
            title: sound.t,
          }));
          setAppData(prev => ({
            ...prev,
            ambientSounds: sharedAmbientSounds,
          }));
          // Auto-play first ambient sound
          const firstAmbient = sharedAmbientSounds[0];
          setAmbientVideoId(firstAmbient.videoId);
          setCurrentAmbientId(firstAmbient.videoId);
          setAmbientVideoTitle(firstAmbient.title);
          setAmbientPlaying(true);
        }

        // Check if there are local videos that need linking
        const localItems = sharedPlaylist.items.filter(item => item.isLocalFile);
        if (localItems.length > 0) {
          alert(`This playlist contains ${localItems.length} local video(s). You'll need to link them to files on your computer.`);
        }

        // Start playing the playlist
        let startIndex = 0;
        if (sharedPlaylist.startRandom && sharedPlaylist.items.length > 0) {
          startIndex = Math.floor(Math.random() * sharedPlaylist.items.length);
        }
        // Find first playable (skip local videos for now)
        const firstPlayableIndex = sharedPlaylist.items.findIndex((item, idx) =>
          !item.isLocalFile && (sharedPlaylist.startRandom ? idx === startIndex : true)
        );
        const actualStartIndex = firstPlayableIndex >= 0 ? firstPlayableIndex :
          sharedPlaylist.items.findIndex(item => !item.isLocalFile);

        if (actualStartIndex >= 0) {
          setActivePlaylist(sharedPlaylist);
          setPlaylistIndex(actualStartIndex);
          setIsPlaylistMode(true);
          const item = sharedPlaylist.items[actualStartIndex];
          setVideoId(item.videoId);
          setVideoUrl(item.url);
          setLocalVideoUrl(null);
          setLocalVideoName('');
          setCurrentVideo(null);
          setGeneralNotes('');
          setAnnotations([]);
          setSidebarTab('playlists');
        } else {
          alert('This playlist only contains local videos. Cannot play automatically.');
        }

        // Clear the URL parameter
        window.history.replaceState({}, '', window.location.pathname);
      } catch (err) {
        console.error('Failed to load shared playlist:', err);
      }
    }
  }, []);

  // Import data from JSON file
  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);

        // Handle new single-video format (version 2)
        if (data.video && data.version === 2) {
          const video = data.video as SavedVideo;
          setPendingImportVideo(video);
          setImportTargetFolderId(appData.folders.length > 0 ? appData.folders[0].id : null);

          if (video.isLocalFile) {
            setLocalVideosToLink([video]);
            setCurrentLinkingVideo(video);
            setLinkedLocalVideos(new Map());
          }
          setShowImportModal(true);
        }
        // Handle old full backup format (version 1)
        else if (data.folders && data.videos) {
          const localVideos = data.videos.filter((v: SavedVideo) => v.isLocalFile);

          if (localVideos.length > 0) {
            setPendingImportData(data);
            setLocalVideosToLink(localVideos);
            setCurrentLinkingVideo(localVideos[0]);
            setLinkedLocalVideos(new Map());
            setShowImportModal(true);
          } else {
            setAppData({ folders: data.folders, videos: data.videos, playlists: data.playlists || [] });
          }
        } else {
          alert('Invalid backup file format');
        }
      } catch (err) {
        alert('Failed to parse backup file');
      }
    };
    reader.readAsText(file);

    // Reset file input
    if (importFileInputRef.current) {
      importFileInputRef.current.value = '';
    }
  };

  // Handle linking a local video file during import
  const handleLinkVideoFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentLinkingVideo) return;

    const url = URL.createObjectURL(file);
    const newLinkedVideos = new Map(linkedLocalVideos);
    newLinkedVideos.set(currentLinkingVideo.id, url);
    setLinkedLocalVideos(newLinkedVideos);

    // Move to next video or finish
    const currentIndex = localVideosToLink.findIndex(v => v.id === currentLinkingVideo.id);
    if (currentIndex < localVideosToLink.length - 1) {
      setCurrentLinkingVideo(localVideosToLink[currentIndex + 1]);
    } else {
      setCurrentLinkingVideo(null);
    }

    // Reset file input
    if (linkVideoInputRef.current) {
      linkVideoInputRef.current.value = '';
    }
  };

  // Skip linking current video
  const handleSkipLinkVideo = () => {
    if (!currentLinkingVideo) return;

    const currentIndex = localVideosToLink.findIndex(v => v.id === currentLinkingVideo.id);
    if (currentIndex < localVideosToLink.length - 1) {
      setCurrentLinkingVideo(localVideosToLink[currentIndex + 1]);
    } else {
      setCurrentLinkingVideo(null);
    }
  };

  // Complete the import process
  const handleCompleteImport = () => {
    if (pendingImportVideo) {
      // Single video import (version 2 format)
      let targetFolderId = importTargetFolderId;

      // If no folder selected and no folders exist, create a default "Imported" folder
      if (!targetFolderId) {
        const newFolder: Folder = {
          id: Date.now().toString(),
          name: 'Imported',
          parentId: null,
          isExpanded: true,
        };
        setAppData(prev => ({
          ...prev,
          folders: [...prev.folders, newFolder],
        }));
        targetFolderId = newFolder.id;
      }

      // Create the video with the target folder
      const linkedUrl = linkedLocalVideos.get(pendingImportVideo.id);
      const newVideo: SavedVideo = {
        ...pendingImportVideo,
        id: `${targetFolderId}/${Date.now()}`,
        url: linkedUrl || pendingImportVideo.url,
      };

      setAppData(prev => ({
        ...prev,
        videos: [...prev.videos, newVideo],
      }));

      // Load the video
      if (newVideo.isLocalFile && linkedUrl) {
        setLocalVideoUrl(linkedUrl);
        setLocalVideoName(newVideo.localFileName || 'Local Video');
        setVideoId(null);
        setVideoUrl('');
      } else if (!newVideo.isLocalFile) {
        setVideoUrl(newVideo.url);
        setVideoId(newVideo.videoId);
        setLocalVideoUrl(null);
        setLocalVideoName('');
      }
      setGeneralNotes(newVideo.generalNotes);
      setAnnotations(newVideo.annotations);
      setCurrentVideo(newVideo);
      setSelectedFolderId(targetFolderId);
    } else if (pendingImportData) {
      // Bulk import from file (version 1 format)
      const updatedVideos = pendingImportData.videos.map(video => {
        if (video.isLocalFile && linkedLocalVideos.has(video.id)) {
          return { ...video, url: linkedLocalVideos.get(video.id)! };
        }
        return video;
      });

      setAppData({ folders: pendingImportData.folders, videos: updatedVideos, playlists: pendingImportData.playlists || [] });
    } else if (localVideosToLink.length === 1 && currentVideo) {
      // Single video re-linking (when clicking on an unlinked local video)
      const linkedUrl = linkedLocalVideos.get(localVideosToLink[0].id);
      if (linkedUrl) {
        setAppData(prev => ({
          ...prev,
          videos: prev.videos.map(v =>
            v.id === localVideosToLink[0].id ? { ...v, url: linkedUrl } : v
          ),
        }));
        setLocalVideoUrl(linkedUrl);
        setLocalVideoName(localVideosToLink[0].localFileName || 'Local Video');
      }
    } else if (localVideosToLink.length === 1 && !currentVideo && !pendingImportVideo && !pendingImportData) {
      // Shared local video from URL - just load it without saving to folder
      const linkedUrl = linkedLocalVideos.get(localVideosToLink[0].id);
      if (linkedUrl) {
        setLocalVideoUrl(linkedUrl);
        setLocalVideoName(localVideosToLink[0].localFileName || 'Local Video');
        setVideoId(null);
        setVideoUrl('');
        // generalNotes and annotations are already set from the URL loading
      }
    }

    setShowImportModal(false);
    setPendingImportData(null);
    setPendingImportVideo(null);
    setImportTargetFolderId(null);
    setLocalVideosToLink([]);
    setCurrentLinkingVideo(null);
    setLinkedLocalVideos(new Map());
  };

  // Cancel import
  const handleCancelImport = () => {
    // Revoke any created URLs
    linkedLocalVideos.forEach(url => URL.revokeObjectURL(url));

    setShowImportModal(false);
    setPendingImportData(null);
    setPendingImportVideo(null);
    setImportTargetFolderId(null);
    setLocalVideosToLink([]);
    setCurrentLinkingVideo(null);
    setLinkedLocalVideos(new Map());
  };

  // Auto-save current video when notes/annotations change
  useEffect(() => {
    if (currentVideo) {
      const timeout = setTimeout(updateCurrentVideo, 1000);
      return () => clearTimeout(timeout);
    }
  }, [generalNotes, annotations]);

  // Notes handlers
  const handleEditNotes = () => {
    setEditNotesValue(generalNotes);
    setIsEditingNotes(true);
  };

  const handleSaveNotes = () => {
    setGeneralNotes(editNotesValue);
    setIsEditingNotes(false);
  };

  const handleCancelNotes = () => {
    setEditNotesValue(generalNotes);
    setIsEditingNotes(false);
  };

  // Fetch YouTube video title using oEmbed API
  const fetchYouTubeTitle = async (videoId: string): Promise<string> => {
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );
      if (response.ok) {
        const data = await response.json();
        return data.title || '';
      }
    } catch (err) {
      console.error('Failed to fetch video title:', err);
    }
    return '';
  };

  // Video player handlers
  const handleLoadVideo = async () => {
    const id = extractVideoId(videoUrl);
    setVideoId(id);
    setLocalVideoUrl(null);
    setLocalVideoName('');
    setCurrentVideo(null);
    setGeneralNotes('');
    setAnnotations([]);
    setFetchedVideoTitle('');

    // Fetch the video title
    if (id) {
      const title = await fetchYouTubeTitle(id);
      setFetchedVideoTitle(title);
    }
  };

  const handleLoadLocalFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Revoke previous URL to prevent memory leaks
      if (localVideoUrl) {
        URL.revokeObjectURL(localVideoUrl);
      }
      const url = URL.createObjectURL(file);
      setLocalVideoUrl(url);
      setLocalVideoName(file.name);
      setVideoId(null);
      setVideoUrl('');
      setCurrentVideo(null);
      setGeneralNotes('');
      setAnnotations([]);
    }
    // Reset file input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePlayerReady = (event: YouTubeEvent) => {
    playerRef.current = event.target;
    // Set volume based on mixer settings
    if (playerRef.current) {
      playerRef.current.setVolume(mainVideoVolume);
      if (mainVideoMuted) {
        playerRef.current.mute();
      }
      // Explicitly start playback in playlist mode (autoplay can be unreliable)
      if (isPlaylistMode) {
        playerRef.current.playVideo();

        // Handle random time seek after video starts
        if (pendingRandomSeek.current) {
          // Wait a bit for duration to be available, then seek
          setTimeout(() => {
            if (playerRef.current && pendingRandomSeek.current) {
              const duration = playerRef.current.getDuration();
              if (duration > 0) {
                // Seek to random point between 0% and 80% of the video
                const randomTime = Math.random() * duration * 0.8;
                playerRef.current.seekTo(randomTime, true);
              }
              pendingRandomSeek.current = false;
            }
          }, 500);
        }
      }
    }
  };

  // Handle video end - auto-advance in playlist mode
  const handleVideoEnd = () => {
    if (isPlaylistMode && activePlaylist && activePlaylist.items.length > 0) {
      // Auto-advance to next video (respects shuffle and loop settings)
      playlistNext();
    }
  };

  const handleAddAnnotation = useCallback(async () => {
    if (!newAnnotation.trim()) return;

    let currentTime = 0;

    if (localVideoUrl && localVideoRef.current) {
      currentTime = localVideoRef.current.currentTime;
    } else if (playerRef.current) {
      currentTime = await playerRef.current.getCurrentTime();
    } else {
      return;
    }

    const annotation: Annotation = {
      id: Date.now().toString(),
      timestamp: currentTime,
      title: newAnnotation.trim(),
    };

    setAnnotations(prev => [...prev, annotation].sort((a, b) => a.timestamp - b.timestamp));
    setNewAnnotation('');
  }, [newAnnotation, localVideoUrl]);

  const handlePlay = (timestamp: number) => {
    if (localVideoUrl && localVideoRef.current) {
      localVideoRef.current.currentTime = timestamp;
      localVideoRef.current.play();
    } else if (playerRef.current) {
      playerRef.current.seekTo(timestamp, true);
      playerRef.current.playVideo();
    }
  };

  const handleDeleteAnnotation = (id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  };

  const handleUpdateAnnotation = (id: string, updates: Partial<Annotation>) => {
    setAnnotations(prev =>
      prev.map(a => a.id === id ? { ...a, ...updates } : a)
    );
  };

  const opts = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: (isPlaylistMode ? 1 : 0) as 0 | 1,
    },
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Scorevision Annotate</h1>
        <div className="header-actions">
          <button
            onClick={handleNew}
            className="header-btn new-btn"
            title="Start new annotation"
          >
            New
          </button>
          <button
            onClick={() => {
              if (isPlaylistMode && activePlaylist) {
                handleSharePlaylist(activePlaylist);
              } else {
                handleShare();
              }
            }}
            className="header-btn share-btn"
            title={isPlaylistMode ? "Share playlist via URL" : "Share via URL"}
          >
            Share
          </button>
          <button
            onClick={handleExport}
            className="header-btn"
            title="Export current session"
          >
            Export
          </button>
          <input
            type="file"
            ref={importFileInputRef}
            accept=".json"
            onChange={handleImportFile}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => importFileInputRef.current?.click()}
            className="header-btn"
            title="Import video notes"
          >
            Import
          </button>
        </div>
      </header>

      <div className="app-body">
        {/* Sidebar */}
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${sidebarTab === 'annotations' ? 'active' : ''}`}
              onClick={() => setSidebarTab('annotations')}
            >
              Annotations
            </button>
            <button
              className={`sidebar-tab ${sidebarTab === 'playlists' ? 'active' : ''}`}
              onClick={() => setSidebarTab('playlists')}
            >
              Playlists
            </button>
          </div>

          {sidebarTab === 'annotations' ? (
            <>
              <div className="sidebar-header">
                <h3>Library</h3>
                <button
                  onClick={() => setShowNewFolderInput(true)}
                  className="new-folder-btn"
                  title="New folder"
                >
                  + Folder
                </button>
              </div>

              {showNewFolderInput && (
                <div className="new-folder-input">
                  <input
                    type="text"
                    placeholder="Folder name..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newFolderName.trim()) {
                        createFolder(null, newFolderName.trim());
                        setNewFolderName('');
                        setShowNewFolderInput(false);
                      }
                      if (e.key === 'Escape') {
                        setShowNewFolderInput(false);
                        setNewFolderName('');
                      }
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      if (newFolderName.trim()) {
                        createFolder(null, newFolderName.trim());
                        setNewFolderName('');
                      }
                      setShowNewFolderInput(false);
                    }}
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => {
                      setShowNewFolderInput(false);
                      setNewFolderName('');
                    }}
                  >
                    ×
                  </button>
                </div>
              )}

              <div
                className="folder-tree"
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggedItem?.type === 'folder') {
                    setRootDropZoneActive(true);
                  }
                }}
                onDragLeave={(e) => {
                  // Only deactivate if leaving the folder-tree entirely
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setRootDropZoneActive(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedItem?.type === 'folder') {
                    handleDrop(null);
                  }
                }}
              >
                {rootDropZoneActive && draggedItem?.type === 'folder' && (
                  <div className="root-drop-zone">
                    Drop here to move to root level
                  </div>
                )}
                {rootFolders.length === 0 && !rootDropZoneActive ? (
                  <p className="no-folders">No folders yet. Create one to organize your videos.</p>
                ) : (
                  rootFolders.map(folder => (
                    <FolderItem
                      key={folder.id}
                      folder={folder}
                      folders={appData.folders}
                      videos={appData.videos}
                      selectedVideoId={currentVideo?.id || null}
                      selectedFolderId={selectedFolderId}
                      onSelectFolder={setSelectedFolderId}
                      onSelectVideo={loadVideo}
                      onToggleExpand={toggleFolderExpand}
                      onCreateSubfolder={(parentId, name) => {
                        createFolder(parentId, name);
                      }}
                      onDeleteFolder={deleteFolder}
                      onRenameFolder={renameFolder}
                      onDeleteVideo={deleteVideo}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDrop={handleDrop}
                      draggedItem={draggedItem}
                      depth={0}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="sidebar-header">
                <h3>Playlists</h3>
                <button
                  onClick={() => openPlaylistModal()}
                  className="new-folder-btn"
                  title="New playlist"
                >
                  + Playlist
                </button>
              </div>

              <div className="playlist-list">
                {appData.playlists.length === 0 ? (
                  <p className="no-folders">No playlists yet. Create one to queue videos.</p>
                ) : (
                  appData.playlists.map(playlist => (
                    <PlaylistSidebarItem
                      key={playlist.id}
                      playlist={playlist}
                      isActive={activePlaylist?.id === playlist.id}
                      onPlay={() => playPlaylist(playlist)}
                      onDelete={() => deletePlaylist(playlist.id)}
                    />
                  ))
                )}
              </div>
            </>
          )}
          {/* Sidebar Resize Edge */}
          <div
            className={`panel-resize-edge ${isResizingSidebar ? 'active' : ''}`}
            onMouseDown={handleSidebarResizeStart}
          />
        </aside>

        {/* Main Content */}
        <main className="main-content">
          <div className="video-section" ref={videoSectionRef}>
            {/* Playlist Controls Bar */}
            {isPlaylistMode && activePlaylist && (
              <div className="playlist-controls-bar">
                <div className="playlist-info-bar">
                  <span className="playlist-now-playing">Now Playing: {activePlaylist.name}</span>
                  <span className="playlist-position">
                    {playlistIndex + 1} / {activePlaylist.items.length}
                  </span>
                  {!appData.playlists.some(p => p.id === activePlaylist.id) && (
                    <button
                      className="save-playlist-btn"
                      onClick={() => {
                        setAppData(prev => ({
                          ...prev,
                          playlists: [...prev.playlists, activePlaylist],
                        }));
                        alert('Playlist saved to your library!');
                      }}
                      title="Save playlist to library"
                    >
                      💾 Save Playlist
                    </button>
                  )}
                </div>
                <div className="playlist-nav-controls">
                  <button
                    onClick={playlistPrev}
                    disabled={!activePlaylist.loop && playlistIndex === 0}
                    className="playlist-nav-btn"
                    title="Previous"
                  >
                    ⏮
                  </button>
                  <button
                    onClick={() => togglePlaylistLoop(activePlaylist.id)}
                    className={`playlist-loop-btn ${activePlaylist.loop ? 'active' : ''}`}
                    title={activePlaylist.loop ? 'Disable loop' : 'Enable loop'}
                  >
                    🔁
                  </button>
                  <button
                    onClick={() => togglePlaylistStartRandom(activePlaylist.id)}
                    className={`playlist-shuffle-btn ${activePlaylist.startRandom ? 'active' : ''}`}
                    title={activePlaylist.startRandom ? 'Disable random/shuffle' : 'Enable random/shuffle'}
                  >
                    🔀
                  </button>
                  <button
                    onClick={() => togglePlaylistRandomTime(activePlaylist.id)}
                    className={`playlist-random-time-btn ${activePlaylist.randomTime ? 'active' : ''}`}
                    title={activePlaylist.randomTime ? 'Disable random start time' : 'Enable random start time'}
                  >
                    ⏱️
                  </button>
                  <button
                    onClick={playlistNext}
                    disabled={!activePlaylist.loop && !activePlaylist.startRandom && playlistIndex === activePlaylist.items.length - 1}
                    className="playlist-nav-btn"
                    title="Next"
                  >
                    ⏭
                  </button>
                  <button
                    onClick={exitPlaylistMode}
                    className="playlist-exit-btn"
                    title="Exit playlist mode"
                  >
                    ✕ Exit
                  </button>
                </div>
              </div>
            )}
            <div className="aspect-ratio-controls">
              {ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio.label}
                  className={`ratio-btn ${aspectRatio === ratio.value && !playerHeight ? 'active' : ''}`}
                  onClick={() => {
                    setAspectRatio(ratio.value);
                    setCustomRatio(ratio.label);
                    setPlayerHeight(null);
                  }}
                >
                  {ratio.label}
                </button>
              ))}
              <input
                type="text"
                className="custom-ratio-input"
                value={customRatio}
                onChange={(e) => handleCustomRatioChange(e.target.value)}
                placeholder="W:H"
              />
            </div>
            <div
              className="player-container"
              style={playerHeight ? { height: playerHeight } : { aspectRatio: aspectRatio }}
            >
              {videoId ? (
                <YouTube
                  key={videoId}
                  videoId={videoId}
                  opts={opts}
                  onReady={handlePlayerReady}
                  onEnd={handleVideoEnd}
                  className="youtube-player"
                />
              ) : localVideoUrl ? (
                <video
                  key={localVideoUrl}
                  ref={localVideoRef}
                  src={localVideoUrl}
                  controls
                  className="local-video-player"
                  onEnded={handleVideoEnd}
                />
              ) : (
                <div className="video-placeholder">
                  <p>Enter a YouTube URL or load a local video file</p>
                </div>
              )}
            </div>
            <div
              className={`resize-handle ${isResizing ? 'active' : ''}`}
              onMouseDown={handleResizeStart}
            >
              <span>⋯</span>
            </div>

            {/* Audio Mixer - only in playlist mode */}
            {isPlaylistMode && (
            <div className="audio-mixer-integrated">
              {/* Main Video Volume */}
              <div className="mixer-channel main-channel">
                <span className="channel-label">Video</span>
                <button
                  className={`mixer-mute-btn ${mainVideoMuted ? 'muted' : ''}`}
                  onClick={toggleMainVideoMute}
                  title={mainVideoMuted ? 'Unmute' : 'Mute'}
                >
                  {mainVideoMuted ? '🔇' : '🔊'}
                </button>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={mainVideoVolume}
                  onChange={(e) => updateMainVideoVolume(parseInt(e.target.value))}
                  className="mixer-volume-slider"
                  title={`Volume: ${mainVideoVolume}%`}
                />
                <span className="mixer-volume-value">{mainVideoVolume}%</span>
              </div>

              {/* Ambient Audio Channel */}
              <div className="mixer-channel ambient-channel">
                <span className="channel-label">Ambient</span>
                {currentAmbientId ? (
                  <>
                    <button
                      className={`mixer-play-btn ${ambientPlaying ? 'playing' : ''}`}
                      onClick={toggleAmbientPlay}
                      title={ambientPlaying ? 'Pause' : 'Play'}
                    >
                      {ambientPlaying ? '⏸' : '▶'}
                    </button>
                    <button
                      className={`mixer-mute-btn ${ambientMuted ? 'muted' : ''}`}
                      onClick={toggleAmbientMute}
                      title={ambientMuted ? 'Unmute' : 'Mute'}
                    >
                      {ambientMuted ? '🔇' : '🔊'}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={ambientVolume}
                      onChange={(e) => updateAmbientVolume(parseInt(e.target.value))}
                      className="mixer-volume-slider"
                      title={`Volume: ${ambientVolume}%`}
                    />
                    <span className="mixer-volume-value">{ambientVolume}%</span>
                    <span className="ambient-title" title={ambientVideoTitle}>
                      {ambientVideoTitle}
                    </span>
                    {(() => {
                      const savedSound = appData.ambientSounds?.find(s => s.videoId === currentAmbientId);
                      if (savedSound) {
                        // Already saved - show edit button
                        return (
                          <button
                            className="ambient-edit-btn"
                            onClick={() => editAmbientSoundName(savedSound.id)}
                            title="Edit name"
                          >
                            ✎
                          </button>
                        );
                      } else {
                        // Not saved - show save button
                        return (
                          <button
                            className="ambient-save-btn"
                            onClick={saveCurrentAmbientSound}
                            title="Save to library"
                          >
                            💾
                          </button>
                        );
                      }
                    })()}
                    <button
                      className="mixer-remove-btn"
                      onClick={clearAmbientAudio}
                      title="Remove ambient audio"
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <div className="ambient-add-section">
                    {showAmbientUrlInput ? (
                      /* URL input mode */
                      <div className="ambient-add">
                        <input
                          type="text"
                          placeholder="Paste YouTube URL..."
                          value={ambientVideoUrl}
                          onChange={(e) => setAmbientVideoUrl(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && ambientVideoUrl.trim()) {
                              setAmbientAudio(ambientVideoUrl);
                              setAmbientVideoUrl('');
                              setShowAmbientUrlInput(false);
                            }
                          }}
                          autoFocus
                        />
                        <button
                          onClick={() => {
                            if (ambientVideoUrl.trim()) {
                              setAmbientAudio(ambientVideoUrl);
                              setAmbientVideoUrl('');
                              setShowAmbientUrlInput(false);
                            }
                          }}
                        >
                          Add
                        </button>
                        <button
                          className="ambient-cancel-btn"
                          onClick={() => {
                            setShowAmbientUrlInput(false);
                            setAmbientVideoUrl('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      /* Default: dropdown + Add New button */
                      <div className="ambient-saved-sounds">
                        <select
                          onChange={(e) => {
                            const sound = appData.ambientSounds?.find(s => s.id === e.target.value);
                            if (sound) {
                              loadAmbientSound(sound);
                            }
                            e.target.value = '';
                          }}
                          defaultValue=""
                        >
                          <option value="" disabled>
                            {(appData.ambientSounds?.length || 0) > 0 ? 'Select ambient...' : 'No saved sounds'}
                          </option>
                          {appData.ambientSounds?.map(sound => (
                            <option key={sound.id} value={sound.id}>
                              {sound.title}
                            </option>
                          ))}
                        </select>
                        <button
                          className="ambient-add-new-btn"
                          onClick={() => setShowAmbientUrlInput(true)}
                          title="Add new ambient sound"
                        >
                          +
                        </button>
                        {(appData.ambientSounds?.length || 0) > 0 && (
                          <button
                            className="ambient-manage-btn"
                            onClick={() => {
                              const toDelete = prompt('Enter the name of the ambient sound to delete (or cancel):');
                              if (toDelete) {
                                const sound = appData.ambientSounds?.find(s =>
                                  s.title.toLowerCase().includes(toDelete.toLowerCase())
                                );
                                if (sound) {
                                  deleteAmbientSound(sound.id);
                                } else {
                                  alert('Sound not found');
                                }
                              }
                            }}
                            title="Delete saved sound"
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            )}
          </div>

          {isPlaylistMode && activePlaylist ? (
            /* Playlist Mode - Simple panel with video list */
            <div className="notes-section playlist-panel" style={{ width: notesWidth }}>
              <div
                className={`panel-resize-edge left ${isResizingNotes ? 'active' : ''}`}
                onMouseDown={handleNotesResizeStart}
              />
              <div className="panel playlist-videos-panel">
                <div className="panel-header">
                  <h2>{activePlaylist.name}</h2>
                  <span className="playlist-video-count">{activePlaylist.items.length} videos</span>
                </div>
                <div className="playlist-add-video">
                  <input
                    type="text"
                    placeholder="Paste YouTube URL to add..."
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && videoUrl.trim()) {
                        addYouTubeToPlaylist(activePlaylist.id, videoUrl);
                        setVideoUrl('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (videoUrl.trim()) {
                        addYouTubeToPlaylist(activePlaylist.id, videoUrl);
                        setVideoUrl('');
                      }
                    }}
                  >
                    Add
                  </button>
                </div>
                <div className="panel-content playlist-video-list">
                  {activePlaylist.items.length === 0 ? (
                    <p className="no-annotations">
                      No videos in playlist. Add videos using the input above.
                    </p>
                  ) : (
                    activePlaylist.items.map((item, index) => (
                      <div
                        key={item.id}
                        className={`playlist-video-item ${index === playlistIndex ? 'playing' : ''}`}
                        onClick={() => playlistGoTo(index)}
                      >
                        <span className="playlist-video-index">{index + 1}</span>
                        <span className="playlist-video-title">{item.title}</span>
                        <div className="playlist-video-actions">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              reorderPlaylistItem(activePlaylist.id, index, Math.max(0, index - 1));
                            }}
                            disabled={index === 0}
                            title="Move up"
                          >
                            ↑
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              reorderPlaylistItem(activePlaylist.id, index, Math.min(activePlaylist.items.length - 1, index + 1));
                            }}
                            disabled={index === activePlaylist.items.length - 1}
                            title="Move down"
                          >
                            ↓
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeVideoFromPlaylist(activePlaylist.id, item.id);
                            }}
                            className="remove-btn"
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Annotation Mode - Full notes and annotations panels */
            <div className="notes-section" style={{ width: notesWidth }}>
              {/* Notes Panel Resize Edge */}
              <div
                className={`panel-resize-edge left ${isResizingNotes ? 'active' : ''}`}
                onMouseDown={handleNotesResizeStart}
              />
              <div className="video-input-panel">
                <div className="video-input-row">
                  <input
                    type="text"
                    placeholder="Paste YouTube URL or video ID..."
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
                  />
                  <button onClick={handleLoadVideo}>Load</button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="video/*"
                    onChange={handleLoadLocalFile}
                    style={{ display: 'none' }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="load-file-btn"
                    title="Load local video file"
                  >
                    📁 File
                  </button>
                  {(videoId || localVideoUrl) && (
                    <button onClick={openSaveDialog} className="save-video-btn">
                      {currentVideo ? 'Save As' : 'Save'}
                    </button>
                  )}
                </div>
                {localVideoName && (
                  <div className="local-file-name">
                    Playing: {localVideoName}
                  </div>
                )}
              </div>

              <div className="panel general-notes">
                <div className="panel-header">
                  <h2>General Notes</h2>
                  {!isEditingNotes && (
                    <button className="edit-notes-btn" onClick={handleEditNotes}>
                      ✎
                    </button>
                  )}
                </div>
                <div className="panel-content">
                  {isEditingNotes ? (
                    <>
                      <textarea
                        placeholder="Write your general notes about this video here..."
                        value={editNotesValue}
                        onChange={(e) => setEditNotesValue(e.target.value)}
                        autoFocus
                      />
                      <div className="notes-actions">
                        <button onClick={handleSaveNotes} className="save-btn">Save</button>
                        <button onClick={handleCancelNotes} className="cancel-btn">Cancel</button>
                      </div>
                    </>
                  ) : (
                    <div className="notes-display">
                      {generalNotes ? (
                        <p>{generalNotes}</p>
                      ) : (
                        <p className="placeholder-text">No notes yet. Click edit to add notes.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="panel annotations">
                <div className="panel-header">
                  <h2>Timestamped Annotations</h2>
                </div>
                <div className="add-annotation">
                  <input
                    type="text"
                    placeholder="Add a note at current time..."
                    value={newAnnotation}
                    onChange={(e) => setNewAnnotation(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddAnnotation()}
                    disabled={!videoId && !localVideoUrl}
                  />
                  <button onClick={handleAddAnnotation} disabled={!videoId && !localVideoUrl}>
                    Add Note
                  </button>
                </div>

                <div className="panel-content annotations-list">
                  {annotations.length === 0 ? (
                    <p className="no-annotations">
                      No annotations yet. Play the video and add notes at specific timestamps.
                    </p>
                  ) : (
                    annotations.map((annotation) => (
                      <AnnotationItem
                        key={annotation.id}
                        annotation={annotation}
                        onPlay={handlePlay}
                        onDelete={handleDeleteAnnotation}
                        onUpdate={handleUpdateAnnotation}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="modal-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="modal save-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{currentVideo ? 'Edit Video' : 'Save Video'}</h3>
            <div className="save-form">
              <label>Title</label>
              <input
                type="text"
                placeholder="Video title..."
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveVideo()}
                autoFocus
              />

              <label>Folder</label>
              {appData.folders.length > 0 ? (
                <div className="folder-select-row">
                  <select
                    value={saveFolderId || ''}
                    onChange={(e) => setSaveFolderId(e.target.value || null)}
                    className="folder-select"
                  >
                    {appData.folders.map(folder => (
                      <option key={folder.id} value={folder.id}>{folder.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowNewFolderInSaveDialog(true)}
                    className="new-folder-inline-btn"
                    title="Create new folder"
                  >
                    +
                  </button>
                </div>
              ) : (
                <div className="no-folders-save">
                  <p>No folders yet.</p>
                  <button
                    type="button"
                    onClick={() => setShowNewFolderInSaveDialog(true)}
                    className="create-folder-btn"
                  >
                    Create Folder
                  </button>
                  <p className="save-hint">Or save to auto-create "Saved Videos" folder</p>
                </div>
              )}

              {showNewFolderInSaveDialog && (
                <div className="new-folder-inline">
                  <input
                    type="text"
                    placeholder="New folder name..."
                    value={newFolderNameInSaveDialog}
                    onChange={(e) => setNewFolderNameInSaveDialog(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createFolderInSaveDialog();
                      if (e.key === 'Escape') {
                        setShowNewFolderInSaveDialog(false);
                        setNewFolderNameInSaveDialog('');
                      }
                    }}
                    autoFocus
                  />
                  <button onClick={createFolderInSaveDialog} className="confirm-btn">✓</button>
                  <button
                    onClick={() => {
                      setShowNewFolderInSaveDialog(false);
                      setNewFolderNameInSaveDialog('');
                    }}
                    className="cancel-inline-btn"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
            <div className="modal-actions">
              {currentVideo ? (
                <>
                  <button onClick={updateExistingVideo} className="save-btn" disabled={!saveTitle.trim()}>
                    Update
                  </button>
                  <button onClick={saveVideo} className="save-as-btn" disabled={!saveTitle.trim()}>
                    Save as New
                  </button>
                </>
              ) : (
                <button onClick={saveVideo} className="save-btn" disabled={!saveTitle.trim()}>
                  Save
                </button>
              )}
              <button onClick={() => setShowSaveDialog(false)} className="cancel-btn">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal for Local Videos */}
      {showImportModal && (
        <div className="modal-overlay" onClick={handleCancelImport}>
          <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{pendingImportData ? 'Import Full Backup' : pendingImportVideo ? 'Import Video' : 'Link Local Video'}</h3>

            {/* Single video import - show video info and folder selection */}
            {pendingImportVideo && (
              <div className="import-video-info">
                <p className="link-video-title">{pendingImportVideo.title}</p>
                <p className="import-info">
                  {pendingImportVideo.annotations.length} annotation(s) • {pendingImportVideo.generalNotes ? 'Has notes' : 'No notes'}
                </p>

                {/* Folder selection */}
                <div className="folder-select-section">
                  <label>Import to folder:</label>
                  {appData.folders.length > 0 ? (
                    <select
                      value={importTargetFolderId || ''}
                      onChange={(e) => setImportTargetFolderId(e.target.value || null)}
                      className="folder-select"
                    >
                      {appData.folders.map(folder => (
                        <option key={folder.id} value={folder.id}>{folder.name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="no-folders-note">No folders exist. A new "Imported" folder will be created.</p>
                  )}
                </div>
              </div>
            )}

            {currentLinkingVideo ? (
              <>
                <p className="import-info">
                  {pendingImportData
                    ? `Found ${localVideosToLink.length} local video(s) that need to be linked to files on your computer.`
                    : pendingImportVideo
                    ? 'This is a local video. Please select the video file from your computer.'
                    : 'This video is stored locally. Please select the video file from your computer.'}
                </p>
                <div className="link-video-section">
                  {localVideosToLink.length > 1 && (
                    <p className="link-video-label">
                      <strong>Video {localVideosToLink.findIndex(v => v.id === currentLinkingVideo.id) + 1} of {localVideosToLink.length}:</strong>
                    </p>
                  )}
                  {!pendingImportVideo && <p className="link-video-title">{currentLinkingVideo.title}</p>}
                  {currentLinkingVideo.localFileName && (
                    <p className="link-video-filename">
                      Original file: <code>{currentLinkingVideo.localFileName}</code>
                    </p>
                  )}
                  <input
                    type="file"
                    ref={linkVideoInputRef}
                    accept="video/*"
                    onChange={handleLinkVideoFile}
                    style={{ display: 'none' }}
                  />
                  <div className="link-video-actions">
                    <button
                      onClick={() => linkVideoInputRef.current?.click()}
                      className="select-file-btn"
                    >
                      Select Video File
                    </button>
                    {localVideosToLink.length > 1 && (
                      <button
                        onClick={handleSkipLinkVideo}
                        className="skip-btn"
                      >
                        Skip
                      </button>
                    )}
                  </div>
                </div>
                {localVideosToLink.length > 1 && (
                  <div className="import-progress">
                    <p>
                      Linked: {linkedLocalVideos.size} / {localVideosToLink.length}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                {!pendingImportVideo && (
                  <p className="import-ready">
                    {pendingImportData
                      ? `Ready to import. ${linkedLocalVideos.size > 0 ? `Linked ${linkedLocalVideos.size} of ${localVideosToLink.length} local videos.` : ''}`
                      : `Video linked successfully!`}
                  </p>
                )}
                {pendingImportData && localVideosToLink.length > linkedLocalVideos.size && (
                  <p className="import-warning">
                    Note: {localVideosToLink.length - linkedLocalVideos.size} local video(s) were not linked and won't play until you reload them.
                  </p>
                )}
              </>
            )}
            <div className="modal-actions">
              {(pendingImportVideo && !currentLinkingVideo) || (!pendingImportVideo && !currentLinkingVideo) ? (
                <button onClick={handleCompleteImport} className="save-btn">
                  {pendingImportData ? 'Complete Import' : pendingImportVideo ? 'Import' : 'Done'}
                </button>
              ) : pendingImportVideo && !pendingImportVideo.isLocalFile ? (
                <button onClick={handleCompleteImport} className="save-btn">
                  Import
                </button>
              ) : null}
              <button onClick={handleCancelImport} className="cancel-btn">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="modal export-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Export</h3>
            <p className="export-info">Choose what to export:</p>
            <div className="export-options">
              <button
                onClick={exportCurrentVideo}
                className="export-option-btn"
                disabled={!videoId && !localVideoUrl}
              >
                <span className="export-option-icon">🎬</span>
                <span className="export-option-text">
                  <strong>Current Video</strong>
                  <small>Export the currently loaded video with its annotations</small>
                </span>
              </button>
              <button
                onClick={exportEntireLibrary}
                className="export-option-btn"
                disabled={appData.folders.length === 0 && appData.videos.length === 0}
              >
                <span className="export-option-icon">📚</span>
                <span className="export-option-text">
                  <strong>Entire Library</strong>
                  <small>Export all folders and saved videos ({appData.videos.length} video{appData.videos.length !== 1 ? 's' : ''}, {appData.folders.length} folder{appData.folders.length !== 1 ? 's' : ''})</small>
                </span>
              </button>
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowExportModal(false)} className="cancel-btn">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Playlist Modal */}
      {showPlaylistModal && (
        <div className="modal-overlay" onClick={closePlaylistModal}>
          <div className="modal playlist-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingPlaylist ? 'Edit Playlist' : 'New Playlist'}</h3>
            <div className="playlist-form">
              <label>Name</label>
              <input
                type="text"
                placeholder="Playlist name..."
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && savePlaylistModal()}
                autoFocus
              />

              {editingPlaylist && (
                <>
                  <label>Videos ({editingPlaylist.items.length})</label>
                  <div className="playlist-items-list">
                    {editingPlaylist.items.length === 0 ? (
                      <p className="no-items">No videos in this playlist yet.</p>
                    ) : (
                      editingPlaylist.items.map((item, index) => (
                        <div key={item.id} className="playlist-item-row">
                          <span className="item-index">{index + 1}.</span>
                          <span className="item-title">{item.title}</span>
                          <div className="item-actions">
                            <button
                              onClick={() => reorderPlaylistItem(editingPlaylist.id, index, Math.max(0, index - 1))}
                              disabled={index === 0}
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => reorderPlaylistItem(editingPlaylist.id, index, Math.min(editingPlaylist.items.length - 1, index + 1))}
                              disabled={index === editingPlaylist.items.length - 1}
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => removeVideoFromPlaylist(editingPlaylist.id, item.id)}
                              title="Remove"
                              className="remove-item-btn"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="playlist-loop-toggle">
                    <label>
                      <input
                        type="checkbox"
                        checked={editingPlaylist.loop}
                        onChange={() => togglePlaylistLoop(editingPlaylist.id)}
                      />
                      Loop playlist
                    </label>
                  </div>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button onClick={savePlaylistModal} className="save-btn" disabled={!playlistName.trim() && !editingPlaylist}>
                {editingPlaylist ? 'Save' : 'Create'}
              </button>
              <button onClick={closePlaylistModal} className="cancel-btn">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Ambient Audio Player - outside main content to avoid re-renders */}
      {ambientVideoId && (
        <div className="ambient-audio-player-container">
          <YouTube
            key="ambient-player"
            videoId={ambientVideoId}
            opts={{
              height: '1',
              width: '1',
              playerVars: {
                autoplay: 1,
                controls: 0,
                loop: 1,
                playlist: ambientVideoId,
              },
            }}
            onReady={handleAmbientPlayerReady}
            onEnd={handleAmbientPlayerEnd}
          />
        </div>
      )}

    </div>
  );
}

export default App;
