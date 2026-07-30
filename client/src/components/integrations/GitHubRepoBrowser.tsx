// client/src/components/integrations/GitHubRepoBrowser.tsx
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, GitBranch, Star, Code2, FolderOpen,
  File, Check, Cloud, RefreshCw, Upload, ExternalLink,
  ChevronLeft, Search, Lock, Unlock, Copy, GitPullRequest,
  Clock, Eye, Users, Database
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  language: string;
  private: boolean;
  updated_at: string;
  created_at: string;
}

interface GitHubContent {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  html_url: string;
  download_url: string | null;
  content?: string;
  encoding?: string;
}

interface GitHubRepoBrowserProps {
  onSelect: (repo: GitHubRepo, branch: string, path: string) => void;
  onClose: () => void;
  selectedRepos?: string[];
  multiSelect?: boolean;
}

export function GitHubRepoBrowser({ 
  onSelect, 
  onClose, 
  selectedRepos = [],
  multiSelect = false
}: GitHubRepoBrowserProps) {
  const { toast } = useToast();
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [selected, setSelected] = useState<string[]>(selectedRepos);
  
  // Navigation state
  const [currentRepo, setCurrentRepo] = useState<GitHubRepo | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string>("main");
  const [currentPath, setCurrentPath] = useState<string>("");
  const [contents, setContents] = useState<GitHubContent[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"repos" | "files">("repos");
  const [pathStack, setPathStack] = useState<{ name: string; path: string }[]>([]);

  // ─── CHECK CONNECTION ──────────────────────────────────────

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const res = await apiRequest("GET", "/api/integrations/github/status");
      const data = await res.json();
      setIsConnected(data.connected);
      if (data.connected) {
        fetchRepos();
      }
    } catch (e) {
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  };

  // ─── FETCH REPOS ──────────────────────────────────────────

  const fetchRepos = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("GET", "/api/integrations/github/repos");
      const data = await res.json();
      setRepos(data.repos || []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ─── AUTH ──────────────────────────────────────────────────

  const handleAuth = async () => {
    try {
      const res = await apiRequest("GET", "/api/integrations/github/auth");
      const data = await res.json();
      if (data.authUrl) {
        window.open(data.authUrl, "_blank");
        const interval = setInterval(async () => {
          const statusRes = await apiRequest("GET", "/api/integrations/github/status");
          const statusData = await statusRes.json();
          if (statusData.connected) {
            setIsConnected(true);
            fetchRepos();
            clearInterval(interval);
          }
        }, 2000);
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  // ─── OPEN REPO ────────────────────────────────────────────

  const handleOpenRepo = async (repo: GitHubRepo) => {
    setCurrentRepo(repo);
    setCurrentBranch(repo.default_branch || "main");
    setCurrentPath("");
    setPathStack([]);
    setViewMode("files");

    // Fetch branches
    try {
      const res = await apiRequest("GET", `/api/integrations/github/repos/${repo.name}/branches`);
      const data = await res.json();
      setBranches(data.branches || []);
    } catch (e) {
      setBranches([repo.default_branch || "main"]);
    }

    // Fetch root contents
    await fetchContents(repo.name, repo.default_branch || "main", "");
  };

  const fetchContents = async (repoName: string, branch: string, path: string) => {
    setLoading(true);
    try {
      const res = await apiRequest("GET", `/api/integrations/github/repos/${repoName}/contents`, {
        branch,
        path
      });
      const data = await res.json();
      setContents(data.contents || []);
      setCurrentPath(path);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setContents([]);
    } finally {
      setLoading(false);
    }
  };

  // ─── NAVIGATE ──────────────────────────────────────────────

  const handleEnterFolder = (item: GitHubContent) => {
    if (item.type === "dir") {
      setPathStack([...pathStack, { name: item.name, path: item.path }]);
      fetchContents(currentRepo!.name, currentBranch, item.path);
    }
  };

  const handleNavigateUp = () => {
    if (pathStack.length > 0) {
      const newStack = pathStack.slice(0, -1);
      setPathStack(newStack);
      const parentPath = newStack.length > 0 ? newStack[newStack.length - 1].path : "";
      fetchContents(currentRepo!.name, currentBranch, parentPath);
    }
  };

  const handleChangeBranch = async (branch: string) => {
    setCurrentBranch(branch);
    setPathStack([]);
    await fetchContents(currentRepo!.name, branch, "");
  };

  // ─── SELECT FILE/REPO ─────────────────────────────────────

  const handleSelectFile = (item: GitHubContent) => {
    if (item.type === "file" && currentRepo) {
      onSelect(currentRepo, currentBranch, item.path);
      onClose();
    }
  };

  const handleSelectRepo = (repo: GitHubRepo) => {
    if (multiSelect) {
      if (selected.includes(repo.full_name)) {
        setSelected(selected.filter((name) => name !== repo.full_name));
      } else {
        setSelected([...selected, repo.full_name]);
        onSelect(repo, repo.default_branch || "main", "");
      }
    } else {
      handleOpenRepo(repo);
    }
  };

  // ─── SYNC ──────────────────────────────────────────────────

  const handleSyncRepo = async (repo: GitHubRepo) => {
    try {
      const res = await apiRequest("POST", "/api/integrations/sync", {
        sourceType: "github",
        repoId: repo.id,
        repoName: repo.name,
        branch: currentBranch,
      });
      const data = await res.json();
      toast({ title: "Sync started", description: data.message });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  // ─── UI ────────────────────────────────────────────────────

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString();
  };

  const getFileIcon = (item: GitHubContent) => {
    if (item.type === "dir") return <FolderOpen className="h-5 w-5 text-yellow-500" />;
    const ext = item.name.split('.').pop()?.toLowerCase() || '';
    if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) return <Code2 className="h-5 w-5 text-blue-500" />;
    if (['json'].includes(ext)) return <Code2 className="h-5 w-5 text-yellow-500" />;
    if (['html', 'htm'].includes(ext)) return <Code2 className="h-5 w-5 text-orange-500" />;
    if (['css', 'scss', 'less'].includes(ext)) return <Code2 className="h-5 w-5 text-purple-500" />;
    if (['md', 'markdown'].includes(ext)) return <File className="h-5 w-5 text-gray-500" />;
    return <File className="h-5 w-5 text-muted-foreground" />;
  };

  if (!isConnected) {
    return (
      <Card className="p-8 text-center max-w-md mx-auto">
        <GitBranch className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
        <h3 className="text-lg font-semibold mb-2">Connect GitHub</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Connect your GitHub account to import repositories and code.
        </p>
        <Button onClick={handleAuth} className="gap-2">
          <GitBranch className="h-4 w-4" />
          Connect GitHub
        </Button>
      </Card>
    );
  }

  // ─── REPO LIST VIEW ────────────────────────────────────────

  if (viewMode === "repos") {
    const filteredRepos = repos.filter(repo => 
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
      <div className="flex flex-col h-[500px] bg-background border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b bg-muted/20">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Your Repositories
          </h3>
          <Button variant="ghost" size="sm" onClick={fetchRepos}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredRepos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Code2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No repositories found</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredRepos.map((repo) => {
                const isSelected = selected.includes(repo.full_name);
                return (
                  <div
                    key={repo.id}
                    className={`p-3 cursor-pointer hover:bg-muted/30 transition-colors ${
                      isSelected ? "bg-primary/10 border-l-2 border-primary" : ""
                    }`}
                    onClick={() => handleSelectRepo(repo)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm truncate">{repo.name}</h4>
                          {repo.private ? (
                            <Lock className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <Unlock className="h-3 w-3 text-muted-foreground" />
                          )}
                          {repo.language && (
                            <Badge variant="secondary" className="text-[10px]">
                              {repo.language}
                            </Badge>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-sm text-muted-foreground truncate mt-0.5">
                            {repo.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Star className="h-3 w-3" />
                            {repo.stargazers_count}
                          </span>
                          <span className="flex items-center gap-1">
                            <GitPullRequest className="h-3 w-3" />
                            {repo.forks_count}
                          </span>
                          <span>Updated {formatDate(repo.updated_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSyncRepo(repo);
                          }}
                        >
                          <Upload className="h-3 w-3" />
                          Sync
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenRepo(repo);
                          }}
                        >
                          Open
                        </Button>
                        {isSelected && <Check className="h-4 w-4 text-primary ml-1" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <div className="border-t p-2 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ─── FILES VIEW ────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[500px] bg-background border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-2 border-b bg-muted/20">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              if (pathStack.length === 0) {
                setViewMode("repos");
                setCurrentRepo(null);
              } else {
                handleNavigateUp();
              }
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-medium text-sm truncate">
            {currentRepo?.name}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {currentBranch}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {branches.length > 0 && (
            <select
              className="h-7 text-xs border rounded bg-background px-2"
              value={currentBranch}
              onChange={(e) => handleChangeBranch(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => fetchContents(currentRepo!.name, currentBranch, currentPath)}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="px-3 py-1.5 text-xs text-muted-foreground border-b flex items-center gap-1 overflow-x-auto">
        <span className="text-primary cursor-pointer" onClick={() => {
          setPathStack([]);
          fetchContents(currentRepo!.name, currentBranch, "");
        }}>{currentRepo?.name}</span>
        {pathStack.map((p, i) => (
          <span key={i} className="flex items-center">
            <span className="mx-1">/</span>
            <span
              className={`cursor-pointer ${i === pathStack.length - 1 ? 'text-foreground font-medium' : 'hover:text-foreground'}`}
              onClick={() => {
                const newStack = pathStack.slice(0, i + 1);
                setPathStack(newStack);
                fetchContents(currentRepo!.name, currentBranch, p.path);
              }}
            >
              {p.name}
            </span>
          </span>
        ))}
      </div>

      {/* File List */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : contents.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Code2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Empty directory</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {contents.map((item) => (
              <div
                key={item.path}
                className={`flex items-center justify-between p-2.5 cursor-pointer hover:bg-muted/30 transition-colors`}
                onClick={() => item.type === "dir" ? handleEnterFolder(item) : handleSelectFile(item)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {getFileIcon(item)}
                  <div className="min-w-0">
                    <p className="text-sm truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.type === "dir" ? "Folder" : `${(item.size / 1024).toFixed(1)} KB`}
                    </p>
                  </div>
                </div>
                {item.type === "file" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.download_url) window.open(item.download_url, "_blank");
                    }}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-2 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => {
          setViewMode("repos");
          setCurrentRepo(null);
        }}>
          Back to Repos
        </Button>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
