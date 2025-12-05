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

interface AppData {
  folders: Folder[];
  videos: SavedVideo[];
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
      return JSON.parse(saved);
    } catch {
      return { folders: [], videos: [] };
    }
  }
  return { folders: [], videos: [] };
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

  const hasDescription = annotation.description && annotation.description.trim().length > 0;
  const canExpand = hasDescription;

  const handleSave = () => {
    onUpdate(annotation.id, {
      title: (editTitle || '').trim() || annotation.title,
      description: (editDescription || '').trim() || undefined,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(annotation.title);
    setEditDescription(annotation.description || '');
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
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title"
                className="edit-title-input"
              />
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
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

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
    if ((!videoId && !localVideoUrl) || !saveTitle.trim() || !selectedFolderId) return;

    const savedVideo: SavedVideo = {
      id: `${selectedFolderId}/${Date.now()}`,
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
    setShowSaveDialog(false);
    setSaveTitle('');
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

  // Export current session as JSON file
  const handleExport = () => {
    // Export current session - whatever is currently loaded
    if (!videoId && !localVideoUrl) {
      alert('No video loaded to export');
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

  // Load shared data from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const data = params.get('d');

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
            setAppData({ folders: data.folders, videos: data.videos });
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

      setAppData({ folders: pendingImportData.folders, videos: updatedVideos });
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

  // Video player handlers
  const handleLoadVideo = () => {
    const id = extractVideoId(videoUrl);
    setVideoId(id);
    setLocalVideoUrl(null);
    setLocalVideoName('');
    setCurrentVideo(null);
    setGeneralNotes('');
    setAnnotations([]);
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
      autoplay: 0 as const,
    },
  };

  return (
    <div className="app">
      <header className="header">
        <h1>YouTube Notes</h1>
        <div className="header-actions">
          <button
            onClick={handleShare}
            className="header-btn share-btn"
            title="Share via URL"
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
          {/* Sidebar Resize Edge */}
          <div
            className={`panel-resize-edge ${isResizingSidebar ? 'active' : ''}`}
            onMouseDown={handleSidebarResizeStart}
          />
        </aside>

        {/* Main Content */}
        <main className="main-content">
          <div className="video-section" ref={videoSectionRef}>
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
                  videoId={videoId}
                  opts={opts}
                  onReady={handlePlayerReady}
                  className="youtube-player"
                />
              ) : localVideoUrl ? (
                <video
                  ref={localVideoRef}
                  src={localVideoUrl}
                  controls
                  className="local-video-player"
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
          </div>

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
                {(videoId || localVideoUrl) && !currentVideo && selectedFolderId && (
                  <button onClick={() => setShowSaveDialog(true)} className="save-video-btn">
                    Save
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
        </main>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="modal-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Save Video to Folder</h3>
            <p>Saving to: {appData.folders.find(f => f.id === selectedFolderId)?.name}</p>
            <input
              type="text"
              placeholder="Video title..."
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveVideo()}
              autoFocus
            />
            <div className="modal-actions">
              <button onClick={saveVideo} className="save-btn">Save</button>
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
    </div>
  );
}

export default App;
