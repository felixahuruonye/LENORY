import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useMemoryEntries } from "@/hooks/useSupabaseData";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Link } from "wouter";
import {
  ArrowLeft,
  Brain,
  Trash2,
  Edit2,
  Plus,
  Settings,
  Target,
  BookOpen,
  Code2,
  Lightbulb,
  Globe,
  Download,
  HardDrive,
  RotateCcw,
} from "lucide-react";


function RememberedFacts() {
  const { data, isLoading } = useQuery<{ facts: { id: string; text: string; createdAt?: string | null }[] }>({
    queryKey: ["/api/memory/facts"],
    queryFn: async () => (await apiRequest("GET", "/api/memory/facts")).json(),
  });
  const facts = data?.facts || [];
  return (
    <Card className="mb-8 p-6" data-testid="card-remembered-facts">
      <h2 className="text-lg font-semibold mb-1">Remembered by LENORY</h2>
      <p className="text-sm text-muted-foreground mb-4">Things you asked LENORY to remember in chat. These come straight from your saved memory.</p>
      {isLoading ? <div className="text-sm text-muted-foreground">Loading...</div> : facts.length === 0 ? (
        <div className="text-sm text-muted-foreground">Nothing saved yet. Say "remember that I study Computer Science" in chat and it will appear here.</div>
      ) : (
        <ul className="space-y-2">
          {facts.map((f) => (
            <li key={f.id} className="text-sm rounded-md border border-border/50 px-3 py-2">{f.text}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function MemoryPanel() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  
  // Use Supabase hook for faster loading
  const { data: memoryEntries = [], isLoading: entriesLoading } = useMemoryEntries();
  
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [memoryCategories, setMemoryCategories] = useState<{
    id: string;
    title: string;
    icon: any;
    color: string;
    items: { key: string; value: string }[];
  }[]>([
    {
      id: "preferences",
      title: "Learning Preferences",
      icon: Settings,
      color: "from-blue-500 to-cyan-500",
      items: [],
    },
    {
      id: "goals",
      title: "Long-Term Goals",
      icon: Target,
      color: "from-purple-500 to-pink-500",
      items: [],
    },
    {
      id: "skills",
      title: "Technical Skills",
      icon: Code2,
      color: "from-green-500 to-emerald-500",
      items: [],
    },
    {
      id: "interests",
      title: "Subjects of Interest",
      icon: Lightbulb,
      color: "from-orange-500 to-red-500",
      items: [],
    },
    {
      id: "business",
      title: "Business & Education Details",
      icon: Globe,
      color: "from-teal-500 to-cyan-500",
      items: [],
    },
    {
      id: "writing",
      title: "Writing Style",
      icon: BookOpen,
      color: "from-rose-500 to-pink-500",
      items: [],
    },
  ]);

  // Transform Supabase memory entries into categories
  useEffect(() => {
    if (!entriesLoading && memoryEntries.length > 0) {
      // Group entries by category
      const entriesByCategory: Record<string, any[]> = {};
      memoryEntries.forEach((entry: any) => {
        const cat = entry.category || 'preferences';
        if (!entriesByCategory[cat]) entriesByCategory[cat] = [];
        entriesByCategory[cat].push({
          key: entry.id,
          value: entry.content || entry.value || '',
        });
      });

      setMemoryCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          items: entriesByCategory[cat.id] || [],
        }))
      );
    }
  }, [memoryEntries, entriesLoading]);

  const handleSaveMemoryItem = async (categoryId: string, itemKey: string) => {
    setIsSaving(true);
    try {
      const response = await apiRequest("POST", "/api/memory/preferences", { categoryId, itemKey, value: editValue });
      
      setMemoryCategories((prevCategories) =>
        prevCategories.map((cat) =>
          cat.id === categoryId
            ? {
                ...cat,
                items: cat.items.map((item) =>
                  item.key === itemKey ? { ...item, value: editValue } : item
                ),
              }
            : cat
        )
      );
      
      toast({ title: "Saved!", description: "Your preference has been updated" });
      setEditing(null);
    } catch (error) {
      console.error("Save failed:", error);
      toast({
        title: "Save Failed",
        description: "Could not save your preference",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddItem = async (categoryId: string) => {
    const itemKey = prompt("Enter item name (e.g., 'newSkill'):");
    if (!itemKey) return;
    
    const itemValue = prompt("Enter item value:");
    if (!itemValue) return;
    
    setIsSaving(true);
    try {
      const response = await apiRequest("POST", "/api/memory/preferences/add", { categoryId, key: itemKey, value: itemValue });
      
      setMemoryCategories((prevCategories) =>
        prevCategories.map((cat) =>
          cat.id === categoryId
            ? {
                ...cat,
                items: [...cat.items, { key: itemKey, value: itemValue }],
              }
            : cat
        )
      );
      
      toast({ title: "Added!", description: `${itemKey} has been added` });
    } catch (error) {
      console.error("Add failed:", error);
      toast({
        title: "Add Failed",
        description: "Could not add item",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportMemory = async () => {
    setIsExporting(true);
    try {
      const response = await apiRequest("GET", "/api/memory/export");
      const data = await response.json();
      
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lernory-memory-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Success!",
        description: `Memory exported: ${data.messages} messages, ${data.memories} memory entries`,
      });
    } catch (error) {
      console.error("Export failed:", error);
      toast({
        title: "Export Failed",
        description: "Could not export your memory data",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleBackup = async () => {
    setIsBackingUp(true);
    try {
      const response = await apiRequest("POST", "/api/memory/backup", {});
      const data = await response.json();
      
      toast({
        title: "Backup Created!",
        description: `Backup ID: ${data.backup.backupId}\n${data.backup.messageCount} messages backed up`,
      });
    } catch (error) {
      console.error("Backup failed:", error);
      toast({
        title: "Backup Failed",
        description: "Could not create backup",
        variant: "destructive",
      });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleClearMemory = async () => {
    if (!confirm("Are you sure? This will permanently delete all your chat history and memory data.")) return;
    
    setIsClearing(true);
    try {
      const response = await apiRequest("DELETE", "/api/memory/clear", {});
      
      toast({
        title: "Memory Cleared",
        description: "All your learning data has been permanently deleted",
      });
    } catch (error) {
      console.error("Clear failed:", error);
      toast({
        title: "Clear Failed",
        description: "Could not clear memory",
        variant: "destructive",
      });
    } finally {
      setIsClearing(false);
    }
  };

  const handleResetDefaults = () => {
    setMemoryEnabled(true);
    toast({
      title: "Reset Complete",
      description: "Memory settings reset to defaults",
    });
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
        <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-primary/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-4">
                <Skeleton className="h-9 w-9 rounded-md" />
                <div className="flex items-center gap-3">
                  <Brain className="h-6 w-6 text-primary" />
                  <Skeleton className="h-7 w-36" />
                </div>
              </div>
              <Skeleton className="h-9 w-9 rounded-full" />
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <RememberedFacts />
          <Skeleton className="h-24 w-full mb-8 rounded-lg" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-48 rounded-lg" />)}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-primary/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild className="hover-elevate" data-testid="button-back">
                <Link href="/dashboard">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <div className="flex items-center gap-3">
                <Brain className="h-6 w-6 text-primary" />
                <h1 className="text-2xl font-bold">Memory System</h1>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Memory Toggle */}
        <Card className="mb-8 p-6 bg-gradient-to-r from-primary/10 to-chart-2/10 border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold mb-2">Memory System Status</h2>
              <p className="text-sm text-muted-foreground">
                {memoryEnabled
                  ? "Your learning patterns, preferences, and goals are being tracked to personalize your experience."
                  : "Memory system is disabled. Your data won't be tracked."}
              </p>
            </div>
            <Switch
              checked={memoryEnabled}
              onCheckedChange={setMemoryEnabled}
              data-testid="switch-memory-enabled"
            />
          </div>
        </Card>

        {/* Memory Categories */}
        <div className="grid md:grid-cols-2 gap-6">
          {memoryCategories.map((category) => (
            <Card key={category.id} className="hover-elevate transition-all overflow-hidden" data-testid={`card-memory-${category.id}`}>
              <div className={`bg-gradient-to-r ${category.color} p-4`}>
                <div className="flex items-center gap-3">
                  <category.icon className="h-6 w-6 text-white" />
                  <CardTitle className="text-white">{category.title}</CardTitle>
                </div>
              </div>

              <CardContent className="p-4 space-y-3">
                {category.items.map((item) => (
                  <div key={item.key} className="flex items-start justify-between gap-3 p-3 bg-secondary/50 rounded-lg">
                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground font-semibold uppercase mb-1">{item.key}</p>
                      {editing === `${category.id}-${item.key}` ? (
                        <Textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="text-sm mb-2"
                          rows={2}
                        />
                      ) : (
                        <p className="text-sm font-medium">{item.value}</p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      {editing === `${category.id}-${item.key}` ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSaveMemoryItem(category.id, item.key)}
                            className="hover-elevate"
                            disabled={isSaving}
                            data-testid={`button-save-${category.id}-${item.key}`}
                          >
                            {isSaving ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(null)}
                            className="hover-elevate"
                            disabled={isSaving}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(`${category.id}-${item.key}`);
                            setEditValue(item.value);
                          }}
                          className="hover-elevate"
                          data-testid={`button-edit-${category.id}-${item.key}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full hover-elevate"
                  onClick={() => handleAddItem(category.id)}
                  disabled={isSaving}
                  data-testid={`button-add-${category.id}`}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {isSaving ? "Adding..." : "Add Item"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Data Management */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Data Management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">Download your learning data, create backups, or clear your memory.</p>
            <div className="grid md:grid-cols-2 gap-4">
              <Button 
                variant="outline" 
                className="hover-elevate" 
                data-testid="button-export-memory" 
                onClick={handleExportMemory}
                disabled={isExporting}
              >
                <Download className="h-4 w-4 mr-2" />
                {isExporting ? "Exporting..." : "Export Memory Data"}
              </Button>
              <Button 
                variant="outline" 
                className="hover-elevate" 
                data-testid="button-backup-memory" 
                onClick={handleBackup}
                disabled={isBackingUp}
              >
                <HardDrive className="h-4 w-4 mr-2" />
                {isBackingUp ? "Backing up..." : "Create Backup"}
              </Button>
              <Button 
                variant="destructive" 
                className="hover-elevate" 
                data-testid="button-clear-memory" 
                onClick={handleClearMemory}
                disabled={isClearing}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {isClearing ? "Clearing..." : "Clear Memory"}
              </Button>
              <Button 
                variant="outline" 
                className="hover-elevate" 
                data-testid="button-reset-preferences" 
                onClick={handleResetDefaults}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset to Defaults
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
