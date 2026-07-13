import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Link } from "wouter";
import {
  ArrowLeft,
  Image as ImageIcon,
  Film,
  Download,
  Trash2,
  Wand2,
  Loader2,
  History,
  RefreshCw,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function ImageGenAdvanced() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<"image" | "video">("image");

  // Image state
  const [imagePrompt, setImagePrompt] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("photorealistic");

  // Video state
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoQueue, setVideoQueue] = useState<{ id: string; prompt: string; status: string; url?: string }[]>([]);

  const handleDeleteImage = async (imageId: string) => {
    try {
      await apiRequest("DELETE", `/api/generated-images/${imageId}`);
      queryClient.invalidateQueries({ queryKey: ["/api/generated-images"] });
      toast({ title: "Image deleted" });
    } catch {
      toast({ title: "Error", description: "Failed to delete image", variant: "destructive" });
    }
  };

  const { data: generatedImages = [], isLoading: imagesLoading } = useQuery<any[]>({
    queryKey: ["/api/generated-images"],
    enabled: !!user,
  });

  const generateImageMutation = useMutation({
    mutationFn: async (data: { prompt: string; style: string }) => {
      const response = await apiRequest("POST", "/api/generate-image", { ...data, resolution: "1024" });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Image generated!", description: "Your image has been created." });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-images"] });
      setImagePrompt("");
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err?.message || "Could not generate image", variant: "destructive" });
    },
  });

  const generateVideoMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const response = await apiRequest("POST", "/api/video/generate", { prompt });
      return response.json();
    },
    onSuccess: async (data) => {
      if (data.error) {
        toast({ title: "Video failed", description: data.error, variant: "destructive" });
        return;
      }
      const entry = { id: data.id || `vid-${Date.now()}`, prompt: videoPrompt, status: data.status || "processing", url: undefined as string | undefined };
      setVideoQueue((q) => [entry, ...q]);
      setVideoPrompt("");
      toast({ title: "Video queued", description: "Generating… this takes ~60 seconds" });

      // Poll for completion
      let attempts = 0;
      const poll = async () => {
        if (!data.id || attempts > 30) return;
        attempts++;
        try {
          const r = await apiRequest("GET", `/api/video/status/${data.id}`);
          const d = await r.json();
          if (d.output) {
            const url = Array.isArray(d.output) ? d.output[0] : d.output;
            setVideoQueue((q) => q.map((v) => v.id === entry.id ? { ...v, status: "done", url } : v));
            toast({ title: "Video ready!", description: "Your video has been generated." });
          } else if (d.status === "failed") {
            setVideoQueue((q) => q.map((v) => v.id === entry.id ? { ...v, status: "failed" } : v));
          } else {
            setTimeout(poll, 4000);
          }
        } catch { setTimeout(poll, 5000); }
      };
      if (data.output) {
        const url = Array.isArray(data.output) ? data.output[0] : data.output;
        setVideoQueue((q) => [{ ...entry, status: "done", url }, ...q.filter((v) => v.id !== entry.id)]);
      } else {
        setTimeout(poll, 4000);
      }
    },
    onError: () => {
      toast({ title: "Video error", description: "Video generation failed. Please try again.", variant: "destructive" });
    },
  });

  const styles = [
    { id: "photorealistic", name: "Photo" },
    { id: "illustrated", name: "Illustrated" },
    { id: "sketch", name: "Sketch" },
    { id: "3d", name: "3D Render" },
    { id: "watercolor", name: "Watercolor" },
    { id: "neon", name: "Neon" },
  ];

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-primary/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild data-testid="button-back">
                <Link href="/dashboard"><ArrowLeft className="h-5 w-5" /></Link>
              </Button>
              <div className="flex items-center gap-3">
                <img src="/favicon.png" alt="LENORY" className="h-7 w-7 rounded-lg object-cover" />
                <h1 className="text-xl font-bold">Create Studio</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
            </div>
          </div>
          {/* Tab Bar */}
          <div className="flex gap-1 pb-2">
            <button
              onClick={() => setTab("image")}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === "image" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover-elevate"}`}
              data-testid="tab-image"
            >
              <ImageIcon className="h-4 w-4" />
              Images
            </button>
            <button
              onClick={() => setTab("video")}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === "video" ? "bg-purple-600 text-white" : "text-muted-foreground hover:text-foreground hover-elevate"}`}
              data-testid="tab-video"
            >
              <Film className="h-4 w-4" />
              Videos
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {tab === "image" ? (
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Image Generator Panel */}
            <Card data-testid="card-image-generator">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wand2 className="h-5 w-5 text-primary" />
                  Generate Image
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Describe your image</label>
                  <Textarea
                    placeholder="A futuristic Lagos skyline at sunset, ultra-realistic, cinematic lighting..."
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    rows={4}
                    className="resize-none"
                    data-testid="textarea-image-prompt"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Style</label>
                  <div className="grid grid-cols-3 gap-2">
                    {styles.map((style) => (
                      <Button
                        key={style.id}
                        variant={selectedStyle === style.id ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedStyle(style.id)}
                        className="hover-elevate"
                        data-testid={`button-style-${style.id}`}
                      >
                        {style.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => generateImageMutation.mutate({ prompt: imagePrompt, style: selectedStyle })}
                  disabled={generateImageMutation.isPending || !imagePrompt.trim()}
                  data-testid="button-generate-image"
                >
                  {generateImageMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
                  ) : (
                    <><Wand2 className="h-4 w-4 mr-2" />Generate Image (2 credits)</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Image History */}
            <div className="space-y-6">
              {generatedImages.length > 0 && (
                <Card className="overflow-hidden" data-testid="card-preview">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <History className="h-5 w-5 text-primary" />
                      Latest Image
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="w-full aspect-square bg-secondary/50 rounded-lg overflow-hidden flex items-center justify-center">
                      <img
                        src={generatedImages[0].imageUrl}
                        alt={generatedImages[0].prompt}
                        className="w-full h-full object-cover"
                        data-testid="img-preview"
                        onError={(e) => {
                          const target = e.currentTarget;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent && !parent.querySelector('.img-error-msg')) {
                            const msg = document.createElement('p');
                            msg.className = 'img-error-msg text-sm text-muted-foreground text-center p-4';
                            msg.textContent = 'Image failed to load. Try generating again.';
                            parent.appendChild(msg);
                          }
                        }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{generatedImages[0].prompt}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 hover-elevate" asChild data-testid="button-download-preview">
                        <a href={generatedImages[0].imageUrl} download="lenory-image.png">
                          <Download className="h-4 w-4 mr-2" />Download
                        </a>
                      </Button>
                      <Button variant="destructive" size="sm" className="hover-elevate" onClick={() => handleDeleteImage(generatedImages[0].id)} data-testid="button-delete-preview">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card data-testid="card-history">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <History className="h-5 w-5 text-primary" />
                      History
                    </span>
                    <Badge>{generatedImages.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {imagesLoading ? (
                    <div className="text-center py-6"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></div>
                  ) : generatedImages.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No images yet. Generate your first one!</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                      {generatedImages.map((img: any) => (
                        <div key={img.id} className="group relative overflow-hidden rounded-lg" data-testid={`card-history-item-${img.id}`}>
                          <img src={img.imageUrl} alt={img.prompt} className="w-full h-28 object-cover" />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button size="icon" variant="ghost" asChild className="h-8 w-8">
                              <a href={img.imageUrl} download="lenory-image.png">
                                <Download className="h-4 w-4 text-white" />
                              </a>
                            </Button>
                            <Button size="icon" variant="destructive" className="h-8 w-8" onClick={() => handleDeleteImage(img.id)} data-testid={`button-delete-${img.id}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          // VIDEO TAB
          <div className="grid lg:grid-cols-2 gap-8">
            <Card data-testid="card-video-generator">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Film className="h-5 w-5 text-purple-400" />
                  Generate Video
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Describe your video</label>
                  <Textarea
                    placeholder="A river flowing through a Nigerian forest at sunset, cinematic drone shot..."
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    rows={4}
                    className="resize-none"
                    data-testid="textarea-video-prompt"
                  />
                  <p className="text-xs text-muted-foreground">Be specific — describe scene, lighting, movement, style.</p>
                </div>

                {(user as any)?.subscriptionTier === 'premium' || user?.email === 'felixahuruonye@gmail.com' ? (
                  <>
                    <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-sm text-purple-300">
                      <strong>Note:</strong> Each video costs 5 credits.
                    </div>
                    <Button
                      size="lg"
                      className="w-full bg-purple-600 hover:bg-purple-500 text-white"
                      onClick={() => generateVideoMutation.mutate(videoPrompt)}
                      disabled={generateVideoMutation.isPending || !videoPrompt.trim()}
                      data-testid="button-generate-video"
                    >
                      {generateVideoMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
                      ) : (
                        <><Film className="h-4 w-4 mr-2" />Generate Video (5 credits)</>
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-300">
                      <strong>Premium feature:</strong> Video generation is only available on the Premium plan.
                    </div>
                    <Button size="lg" className="w-full bg-amber-600 hover:bg-amber-500 text-white" asChild data-testid="button-upgrade-video">
                      <Link href="/pricing">Upgrade to Premium</Link>
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Video History */}
            <div className="space-y-4">
              <Card data-testid="card-video-history">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <History className="h-5 w-5 text-purple-400" />
                      Your Videos
                    </span>
                    <Badge variant="outline">{videoQueue.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {videoQueue.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Film className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">No videos generated yet.</p>
                      <p className="text-xs mt-1">Generate your first video above.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {videoQueue.map((vid) => (
                        <div key={vid.id} className="border border-border rounded-xl overflow-hidden" data-testid={`card-video-${vid.id}`}>
                          {vid.status === "done" && vid.url ? (
                            <>
                              <video
                                src={vid.url}
                                controls
                                className="w-full aspect-video bg-black"
                                data-testid={`video-player-${vid.id}`}
                              />
                              <div className="p-3 flex items-center justify-between gap-2">
                                <p className="text-xs text-muted-foreground truncate flex-1">{vid.prompt}</p>
                                <Button size="sm" variant="outline" asChild className="flex-shrink-0 hover-elevate" data-testid={`button-download-video-${vid.id}`}>
                                  <a href={vid.url} download="lenory-video.mp4" target="_blank" rel="noopener noreferrer">
                                    <Download className="h-4 w-4 mr-1" />
                                    Download
                                  </a>
                                </Button>
                              </div>
                            </>
                          ) : vid.status === "failed" ? (
                            <div className="p-4 text-center text-destructive text-sm">
                              Generation failed. Try again.
                            </div>
                          ) : (
                            <div className="p-6 text-center space-y-2">
                              <Loader2 className="h-8 w-8 animate-spin mx-auto text-purple-400" />
                              <p className="text-sm text-muted-foreground">Generating video…</p>
                              <p className="text-xs text-muted-foreground truncate">{vid.prompt}</p>
                              <RefreshCw className="h-3 w-3 mx-auto mt-1 text-muted-foreground animate-spin" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
