import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen, Upload, Trash2, Loader2, FileText, Brain,
  MessageCircle, Layers, ChevronLeft, ChevronRight, RotateCw, CheckCircle2, XCircle,
} from "lucide-react";

interface Note {
  id: string;
  fileName: string;
  fileType: string;
  extractedText: string | null;
  processingStatus: string;
  createdAt: string;
}

interface QuizQuestion {
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: string;
}

interface Flashcard {
  front: string;
  back: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export default function Notes() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [quizNote, setQuizNote] = useState<Note | null>(null);
  const [flashcardNote, setFlashcardNote] = useState<Note | null>(null);

  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["/api/notes"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/notes");
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const headers = await authHeaders();
      const res = await fetch("/api/notes/upload", {
        method: "POST",
        credentials: "include",
        headers,
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      if (data?.creditsCharged > 0) {
        toast({ title: "Note uploaded", description: `20 credits used (past your 10 free uploads).` });
      } else {
        toast({ title: "Note uploaded", description: "Your note is ready to practice." });
      }
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/notes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
    },
  });

  const startChatPractice = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/notes/${id}/chat`);
      return res.json();
    },
    onSuccess: (data) => {
      setLocation(`/chat?sessionId=${data.sessionId}`);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't start practice chat", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-purple-500" />
            Knowledge Base
          </h1>
          <p className="text-muted-foreground text-sm">Upload your notes, then quiz yourself before exams.</p>
        </div>
        <div>
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.doc,.docx" className="hidden" onChange={handleFileSelect} />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Upload Note
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : notes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>No notes yet. Upload a photo of your handwritten notes, a PDF, or a document to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {notes.map((note) => (
            <Card key={note.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 shrink-0 text-purple-500" />
                    <CardTitle className="text-base truncate">{note.fileName}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary">{new Date(note.createdAt).toLocaleDateString()}</Badge>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(note.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setQuizNote(note)}>
                    <Brain className="w-4 h-4 mr-1" /> Quiz
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setFlashcardNote(note)}>
                    <Layers className="w-4 h-4 mr-1" /> Flashcards
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={startChatPractice.isPending}
                    onClick={() => startChatPractice.mutate(note.id)}
                  >
                    {startChatPractice.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-1" />}
                    Chat Practice
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {quizNote && <QuizDialog note={quizNote} onClose={() => setQuizNote(null)} />}
      {flashcardNote && <FlashcardDialog note={flashcardNote} onClose={() => setFlashcardNote(null)} />}
    </div>
  );
}

function QuizDialog({ note, onClose }: { note: Note; onClose: () => void }) {
  const { toast } = useToast();
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const generateQuiz = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/notes/${note.id}/quiz`, { questionCount: 5 });
      return res.json();
    },
    onSuccess: (data) => setQuestions(data.questions || []),
    onError: (err: any) => toast({ title: "Couldn't generate quiz", description: err.message, variant: "destructive" }),
  });

  useEffect(() => { generateQuiz.mutate(); }, [note.id]);

  const score = questions ? questions.filter((q, i) => answers[i] === q.correctAnswer).length : 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Brain className="w-5 h-5" /> Quiz: {note.fileName}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 pr-2">
          {generateQuiz.isPending && (
            <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm">Generating questions from your note...</p>
            </div>
          )}
          {questions && questions.length === 0 && !generateQuiz.isPending && (
            <p className="text-center text-muted-foreground py-8">Couldn't generate questions from this note.</p>
          )}
          {questions && questions.length > 0 && (
            <div className="space-y-5">
              {questions.map((q, i) => (
                <div key={i} className="space-y-2">
                  <p className="font-medium text-sm">{i + 1}. {q.questionText}</p>
                  <RadioGroup
                    value={answers[i] || ""}
                    onValueChange={(v) => !submitted && setAnswers((a) => ({ ...a, [i]: v }))}
                  >
                    {q.options.map((opt, oi) => {
                      const isCorrect = submitted && opt === q.correctAnswer;
                      const isWrongPick = submitted && answers[i] === opt && opt !== q.correctAnswer;
                      return (
                        <div key={oi} className={`flex items-center gap-2 rounded-md px-2 py-1 ${isCorrect ? "bg-green-500/10" : isWrongPick ? "bg-red-500/10" : ""}`}>
                          <RadioGroupItem value={opt} id={`q${i}o${oi}`} disabled={submitted} />
                          <Label htmlFor={`q${i}o${oi}`} className="text-sm flex-1 cursor-pointer">{opt}</Label>
                          {isCorrect && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                          {isWrongPick && <XCircle className="w-4 h-4 text-red-500" />}
                        </div>
                      );
                    })}
                  </RadioGroup>
                  {submitted && <p className="text-xs text-muted-foreground pl-2">{q.explanation}</p>}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        {questions && questions.length > 0 && (
          <div className="pt-3 border-t flex items-center justify-between">
            {submitted ? (
              <p className="font-medium">Score: {score} / {questions.length}</p>
            ) : <div />}
            <Button
              onClick={() => submitted ? onClose() : setSubmitted(true)}
              disabled={!submitted && Object.keys(answers).length < questions.length}
            >
              {submitted ? "Done" : "Submit Answers"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FlashcardDialog({ note, onClose }: { note: Note; onClose: () => void }) {
  const { toast } = useToast();
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const generate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/notes/${note.id}/flashcards`);
      return res.json();
    },
    onSuccess: (data) => setCards(data.flashcards || []),
    onError: (err: any) => toast({ title: "Couldn't generate flashcards", description: err.message, variant: "destructive" }),
  });

  useEffect(() => { generate.mutate(); }, [note.id]);

  const current = cards?.[index];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="w-5 h-5" /> Flashcards: {note.fileName}</DialogTitle>
        </DialogHeader>
        {generate.isPending && (
          <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Generating flashcards from your note...</p>
          </div>
        )}
        {cards && cards.length === 0 && !generate.isPending && (
          <p className="text-center text-muted-foreground py-8">Couldn't generate flashcards from this note.</p>
        )}
        {current && (
          <div className="space-y-4">
            <button
              onClick={() => setFlipped((f) => !f)}
              className="w-full min-h-[160px] rounded-lg border bg-card p-6 flex items-center justify-center text-center hover:bg-accent/50 transition"
            >
              <div>
                <p className="text-xs text-muted-foreground mb-2 flex items-center justify-center gap-1">
                  <RotateCw className="w-3 h-3" /> {flipped ? "Answer" : "Question"} — tap to flip
                </p>
                <p className="font-medium">{flipped ? current.back : current.front}</p>
              </div>
            </button>
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={index === 0}
                onClick={() => { setIndex((i) => i - 1); setFlipped(false); }}
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </Button>
              <span className="text-sm text-muted-foreground">{index + 1} / {cards!.length}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={index === cards!.length - 1}
                onClick={() => { setIndex((i) => i + 1); setFlipped(false); }}
              >
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
