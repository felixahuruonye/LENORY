import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronLeft, Trash2, BookOpen, Eye, Volume2, Wand2, Download, X } from "lucide-react";
import { useState, useRef } from "react";
import jsPDF from "jspdf";

interface GeneratedLesson {
  id: string;
  title: string;
  objectives: string[];
  keyPoints: string[];
  summary: string;
  originalText?: string;
  createdAt: string;
}

export default function GeneratedLessons() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedLesson, setSelectedLesson] = useState<GeneratedLesson | null>(null);
  const [playingLessonId, setPlayingLessonId] = useState<string | null>(null);
  const [fixedText, setFixedText] = useState<{ correctedText: string; explanation: string } | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Fetch all generated lessons
  const { data: lessons = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/generated-lessons"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/generated-lessons");
      return res.json();
    },
  });

  const handleDelete = async (id: string) => {
    try {
      await apiRequest("DELETE", `/api/generated-lessons/${id}`);
      toast({
        title: "Deleted",
        description: "Lesson removed successfully.",
      });
      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete lesson",
        variant: "destructive",
      });
    }
  };

  const handleReadAudio = (lesson: GeneratedLesson) => {
    if (!('speechSynthesis' in window)) {
      toast({
        title: "Not supported",
        description: "Text-to-speech is not supported on this device",
        variant: "destructive",
      });
      return;
    }

    // If this lesson is already playing, stop it
    if (playingLessonId === lesson.id) {
      window.speechSynthesis.cancel();
      setPlayingLessonId(null);
      currentUtteranceRef.current = null;
      return;
    }

    // Stop any currently playing audio
    if (playingLessonId) {
      window.speechSynthesis.cancel();
    }

    try {
      const textToRead = lesson.originalText || lesson.summary;
      const utterance = new SpeechSynthesisUtterance(textToRead);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      // Update state when speech starts
      utterance.onstart = () => setPlayingLessonId(lesson.id);

      // Reset state when speech ends or is interrupted
      utterance.onend = () => {
        setPlayingLessonId(null);
        currentUtteranceRef.current = null;
      };
      
      utterance.onerror = () => {
        setPlayingLessonId(null);
        currentUtteranceRef.current = null;
      };

      currentUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to read audio",
        variant: "destructive",
      });
      setPlayingLessonId(null);
      currentUtteranceRef.current = null;
    }
  };

  const handleAIFix = async (lesson: GeneratedLesson) => {
    if (!lesson.originalText) {
      toast({
        title: "No text to fix",
        description: "Original text not available",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsFixing(true);
      const response = await apiRequest("POST", "/api/ai-fix-text", {
        text: lesson.originalText,
      });

      if (!response.ok) throw new Error("Failed to fix text");
      
      const fixed = await response.json();
      setFixedText(fixed);
      toast({
        title: "Text fixed!",
        description: "LENORY AI has corrected your text",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fix text with LENORY AI",
        variant: "destructive",
      });
    } finally {
      setIsFixing(false);
    }
  };

  const handlePDFExport = (lesson: GeneratedLesson) => {
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let yPosition = 20;
      const margin = 15;
      const lineHeight = 7;
      const maxWidth = pageWidth - 2 * margin;

      // Title
      pdf.setFontSize(18);
      pdf.setTextColor(33, 150, 243);
      pdf.text("LENORY - Generated Lesson", margin, yPosition);
      yPosition += 12;

      // Lesson title
      pdf.setFontSize(14);
      pdf.setTextColor(0, 0, 0);
      const titleLines = pdf.splitTextToSize(lesson.title, maxWidth);
      pdf.text(titleLines, margin, yPosition);
      yPosition += titleLines.length * lineHeight + 5;

      // Summary section
      pdf.setFontSize(11);
      pdf.setTextColor(33, 150, 243);
      pdf.text("Summary:", margin, yPosition);
      yPosition += 7;

      pdf.setFontSize(10);
      pdf.setTextColor(0, 0, 0);
      const summaryLines = pdf.splitTextToSize(lesson.summary, maxWidth);
      pdf.text(summaryLines, margin, yPosition);
      yPosition += summaryLines.length * lineHeight + 8;

      // Learning Objectives
      if (lesson.objectives.length > 0) {
        pdf.setFontSize(11);
        pdf.setTextColor(33, 150, 243);
        pdf.text("Learning Objectives:", margin, yPosition);
        yPosition += 7;

        pdf.setFontSize(10);
        pdf.setTextColor(0, 0, 0);
        lesson.objectives.forEach((obj) => {
          if (yPosition > pageHeight - 20) {
            pdf.addPage();
            yPosition = 20;
          }
          const objLines = pdf.splitTextToSize(`• ${obj}`, maxWidth - 5);
          pdf.text(objLines, margin + 5, yPosition);
          yPosition += objLines.length * lineHeight + 2;
        });
        yPosition += 3;
      }

      // Key Points
      if (lesson.keyPoints.length > 0) {
        pdf.setFontSize(11);
        pdf.setTextColor(33, 150, 243);
        pdf.text("Key Points:", margin, yPosition);
        yPosition += 7;

        pdf.setFontSize(10);
        pdf.setTextColor(0, 0, 0);
        lesson.keyPoints.forEach((point) => {
          if (yPosition > pageHeight - 20) {
            pdf.addPage();
            yPosition = 20;
          }
          const pointLines = pdf.splitTextToSize(`• ${point}`, maxWidth - 5);
          pdf.text(pointLines, margin + 5, yPosition);
          yPosition += pointLines.length * lineHeight + 2;
        });
        yPosition += 8;
      }

      // Original Text section
      if (lesson.originalText) {
        pdf.setFontSize(11);
        pdf.setTextColor(33, 150, 243);
        pdf.text("Original Lesson Text:", margin, yPosition);
        yPosition += 7;

        pdf.setFontSize(10);
        pdf.setTextColor(0, 0, 0);
        const textLines = pdf.splitTextToSize(lesson.originalText, maxWidth);
        textLines.forEach((line: string) => {
          if (yPosition > pageHeight - 20) {
            pdf.addPage();
            yPosition = 20;
          }
          pdf.text(line, margin, yPosition);
          yPosition += lineHeight;
        });
      }

      // Footer
      pdf.setFontSize(9);
      pdf.setTextColor(150, 150, 150);
      pdf.text(`Generated by LENORY - ${new Date().toLocaleDateString()}`, margin, pageHeight - 10);

      // Save PDF
      pdf.save(`${lesson.title || "lesson"}.pdf`);
      toast({
        title: "PDF Exported",
        description: "Lesson downloaded successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to export PDF",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/50 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/live-session")}
              data-testid="button-back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold text-center flex-1">Generated Lessons</h1>
            <div className="w-10" />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Information Section */}
        <Card className="p-6 mb-8 bg-gradient-to-br from-blue-900/20 to-purple-900/20 border-blue-700/50">
          <div className="flex gap-4">
            <BookOpen className="h-8 w-8 text-blue-400 flex-shrink-0" />
            <div>
              <h2 className="text-lg font-semibold mb-2">About Generated Lessons</h2>
              <p className="text-sm text-muted-foreground mb-3">
                LENORY AI converts your study sessions into structured learning resources. Each lesson includes:
              </p>
              <ul className="text-sm text-muted-foreground space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-1">•</span>
                  <span><strong>Learning Objectives:</strong> Clear goals you'll achieve</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-1">•</span>
                  <span><strong>Key Points:</strong> Main concepts and takeaways</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-1">•</span>
                  <span><strong>Summary:</strong> Concise overview</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-1">•</span>
                  <span><strong>View, Listen, Fix & Export:</strong> Full lesson management tools</span>
                </li>
              </ul>
            </div>
          </div>
        </Card>

        {/* Lessons List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : lessons.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">
            <p className="mb-4">No generated lessons yet</p>
            <p className="text-sm mb-4">Generate your first lesson by recording a session and clicking "Save as Lesson"</p>
            <Button onClick={() => setLocation("/live-session")}>
              Go to Write My Note
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {lessons.map((lesson: GeneratedLesson) => (
              <Card key={lesson.id} className="p-6 flex flex-col gap-4 hover-elevate cursor-pointer" data-testid={`lesson-card-${lesson.id}`}>
                <div onClick={() => setSelectedLesson(lesson)}>
                  <h3 className="font-semibold text-lg mb-2 truncate">{lesson.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    {new Date(lesson.createdAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Summary Preview */}
                <div onClick={() => setSelectedLesson(lesson)} className="flex-1">
                  <p className="text-sm text-muted-foreground line-clamp-3">{lesson.summary}</p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 mt-auto flex-wrap">
                  <Button
                    onClick={() => setSelectedLesson(lesson)}
                    size="sm"
                    variant="outline"
                    data-testid={`button-view-${lesson.id}`}
                    className="flex-1"
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View
                  </Button>
                  <Button
                    onClick={() => handleReadAudio(lesson)}
                    size="sm"
                    variant={playingLessonId === lesson.id ? "default" : "outline"}
                    data-testid={`button-listen-${lesson.id}`}
                  >
                    <Volume2 className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => handlePDFExport(lesson)}
                    size="sm"
                    variant="outline"
                    data-testid={`button-pdf-${lesson.id}`}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => handleDelete(lesson.id)}
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    data-testid={`button-delete-${lesson.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Full Lesson View Dialog */}
      {selectedLesson && (
        <Dialog open={!!selectedLesson} onOpenChange={() => setSelectedLesson(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-lesson-detail">
            <DialogHeader>
              <DialogTitle className="text-2xl">{selectedLesson.title}</DialogTitle>
              <button
                onClick={() => setSelectedLesson(null)}
                className="absolute right-4 top-4"
                data-testid="button-close-dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </DialogHeader>

            <div className="space-y-6">
              {/* Summary */}
              <div>
                <h3 className="text-lg font-semibold mb-2 text-blue-400">Summary</h3>
                <p className="text-muted-foreground whitespace-pre-wrap">{selectedLesson.summary}</p>
              </div>

              {/* Learning Objectives */}
              {selectedLesson.objectives.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-blue-400">Learning Objectives</h3>
                  <ul className="space-y-2">
                    {selectedLesson.objectives.map((obj, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="text-blue-400 flex-shrink-0">•</span>
                        <span className="text-muted-foreground">{obj}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Key Points */}
              {selectedLesson.keyPoints.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-green-400">Key Points</h3>
                  <ul className="space-y-2">
                    {selectedLesson.keyPoints.map((point, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="text-green-400 flex-shrink-0">•</span>
                        <span className="text-muted-foreground">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Original Text */}
              {selectedLesson.originalText && (
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-purple-400">Original Lesson Text</h3>
                  <Card className="p-4 bg-muted/50 max-h-48 overflow-y-auto">
                    <p className="text-muted-foreground whitespace-pre-wrap">{selectedLesson.originalText}</p>
                  </Card>
                </div>
              )}

              {/* Fixed Text Display */}
              {fixedText && (
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-amber-400">LENORY AI Fixed Text</h3>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1 font-semibold">Corrections Made:</p>
                      <p className="text-sm text-muted-foreground">{fixedText.explanation}</p>
                    </div>
                    <Card className="p-4 bg-muted/50">
                      <p className="text-muted-foreground whitespace-pre-wrap">{fixedText.correctedText}</p>
                    </Card>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 flex-wrap pt-4 border-t">
                <Button
                  onClick={() => handleReadAudio(selectedLesson)}
                  variant={playingLessonId === selectedLesson.id ? "default" : "outline"}
                  data-testid="button-read-audio"
                >
                  <Volume2 className="h-4 w-4 mr-2" />
                  {playingLessonId === selectedLesson.id ? "Stop Reading" : "Read Aloud"}
                </Button>
                <Button
                  onClick={() => handleAIFix(selectedLesson)}
                  disabled={isFixing || !selectedLesson.originalText}
                  variant="outline"
                  data-testid="button-ai-fix"
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  {isFixing ? "Fixing..." : "LENORY AI Fix"}
                </Button>
                <Button
                  onClick={() => handlePDFExport(selectedLesson)}
                  variant="outline"
                  data-testid="button-export-pdf"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
