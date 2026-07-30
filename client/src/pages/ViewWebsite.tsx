import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, ChevronLeft , Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function ViewWebsite() {
  const [, params] = useRoute("/view/:id");
  const [, setLocation] = useLocation();
  
  const { data: website, isLoading } = useQuery({
    queryKey: [`/api/websites/${params?.id}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/websites/${params?.id}`);
      return res.json();
    },
    enabled: !!params?.id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!website) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p>Website not found</p>
        <Button onClick={() => setLocation("/website-generator")}>
          Back to Generator
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-card p-4 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg">{website.title}</h1>
          <p className="text-sm text-muted-foreground">{website.description}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setLocation("/website-generator")}
          data-testid="button-back-to-generator"
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      {/* Website Preview */}
      <div className="flex-1 overflow-hidden">
        <iframe
          srcDoc={`
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>${website.title}</title>
              <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                ${website.cssCode}
              </style>
            </head>
            <body>
              ${website.htmlCode}
              <script>
                ${website.jsCode || ""}
              </script>
            </body>
            </html>
          `}
          className="w-full h-full border-0"
          title="Website Preview"
          data-testid="iframe-view-website"
        />
      </div>
    </div>
  );
}

