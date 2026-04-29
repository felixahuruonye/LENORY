import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, CheckCircle2, BookOpen, TrendingUp, History, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest, getQueryFn } from '@/lib/queryClient';

const EXAM_TYPES = ['JAMB', 'WAEC', 'NECO', 'SAT', 'GRE', 'GMAT'];
const SUBJECTS: Record<string, string[]> = {
  JAMB: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'],
  WAEC: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'],
  NECO: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'],
  SAT: ['Math', 'Reading', 'Writing'],
  GRE: ['Verbal', 'Quantitative', 'Analytical'],
  GMAT: ['Quantitative', 'Verbal', 'Analytical'],
};

export default function CBTModeEnhanced() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<'dashboard' | 'config' | 'loading' | 'exam' | 'results' | 'history' | 'analytics'>('dashboard');
  
  // Exam configuration
  const [selectedExamType, setSelectedExamType] = useState<string>('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [currentSubjectIndex, setCurrentSubjectIndex] = useState(0);
  const [isExamActive, setIsExamActive] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  
  // Questions and answers
  const [questionsBySubject, setQuestionsBySubject] = useState<Record<string, any[]>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [examResult, setExamResult] = useState<any>(null);
  const [timeRemaining, setTimeRemaining] = useState(30 * 60);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStartTime, setLoadingStartTime] = useState<number | null>(null);

  // Fetch exam history
  const { data: examHistory = [] } = useQuery<any[]>({
    queryKey: ['/api/cbt/history'],
    queryFn: getQueryFn({ on401: 'throw' }),
  });

  // Fetch analytics
  const { data: analytics = [] } = useQuery<any[]>({
    queryKey: ['/api/cbt/analytics'],
    queryFn: getQueryFn({ on401: 'throw' }),
  });

  // Grade exam mutation
  const gradeMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/cbt/grade', data);
      return await res.json();
    },
    onSuccess: (data: any) => {
      setExamResult(data.gradingResult);
      setView('results');
      setIsExamActive(false);
      toast({ title: '✅ Exam Graded by LENORY!', description: `Your score: ${data.gradingResult.score}%` });
    },
  });

  // Auto-logout when timer reaches 0
  useEffect(() => {
    if (isExamActive && timeRemaining <= 0) {
      handleSubmitExam();
      return;
    }

    if (!isExamActive) return;
    const timer = setTimeout(() => setTimeRemaining(timeRemaining - 1), 1000);
    return () => clearTimeout(timer);
  }, [isExamActive, timeRemaining]);

  // Keyboard handling for exam
  useEffect(() => {
    if (!isExamActive) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      const currentSubject = selectedSubjects[currentSubjectIndex];
      const questions = questionsBySubject[currentSubject] || [];
      const currentQuestion = questions[currentQuestionIndex];

      if (['A', 'B', 'C', 'D'].includes(key) && currentQuestion) {
        const optionIndex = key.charCodeAt(0) - 65;
        const questionKey = `${currentSubject}_${currentQuestionIndex}`;
        setAnswers((prev) => ({ ...prev, [questionKey]: String.fromCharCode(65 + optionIndex) }));

        if (currentQuestionIndex < questions.length - 1) {
          setCurrentQuestionIndex(currentQuestionIndex + 1);
        }
      }

      if (e.key === 'ArrowRight' && currentQuestionIndex < questions.length - 1) {
        setCurrentQuestionIndex(currentQuestionIndex + 1);
      }
      if (e.key === 'ArrowLeft' && currentQuestionIndex > 0) {
        setCurrentQuestionIndex(currentQuestionIndex - 1);
      }

      if (e.key === 'Escape') {
        handleSubmitExam();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isExamActive, currentQuestionIndex, currentSubjectIndex, selectedSubjects, questionsBySubject]);

  const handleStartExam = async () => {
    if (!selectedExamType || selectedSubjects.length === 0) {
      toast({ description: 'Please select exam type and at least one subject' });
      return;
    }

    setView('loading');
    setLoadingStartTime(Date.now());
    setLoadingProgress(0);

    try {
      const questions: Record<string, any[]> = {};
      for (const subject of selectedSubjects) {
        const res = await apiRequest('POST', '/api/cbt/generate-questions', {
          examType: selectedExamType,
          subject,
          count: 50,
        });
        const data = await res.json();
        questions[subject] = data.questions || [];
        setLoadingProgress((prev) => Math.min(prev + Math.floor(100 / selectedSubjects.length), 90));
      }

      setQuestionsBySubject(questions);
      setAnswers({});
      setCurrentQuestionIndex(0);
      setCurrentSubjectIndex(0);
      setTimeRemaining(30 * 60);
      setIsExamActive(true);
      setLoadingProgress(100);
      
      setTimeout(() => {
        setView('exam');
        toast({ title: '✅ Exam Started!', description: 'Press A/B/C/D to answer. ESC to submit.' });
      }, 500);
    } catch (error) {
      setView('config');
      toast({ description: 'Failed to generate exam questions. Try again.' });
      console.error('Question generation error:', error);
    }
  };

  // Loading timer effect
  useEffect(() => {
    if (view !== 'loading' || !loadingStartTime) return;
    
    const timer = setInterval(() => {
      const elapsed = Date.now() - loadingStartTime;
      // Estimate: ~5-30 seconds to generate 50-250 questions
      const estimatedTotal = selectedSubjects.length * 5000; // 5 sec per subject estimate
      const progress = Math.min(Math.floor((elapsed / estimatedTotal) * 100), 95);
      setLoadingProgress(progress);
    }, 100);

    return () => clearInterval(timer);
  }, [view, loadingStartTime, selectedSubjects.length]);

  const handleSubmitExam = async () => {
    if (Object.keys(answers).length === 0) {
      toast({ description: 'Answer at least one question before submitting' });
      return;
    }

    const allQuestions = Object.values(questionsBySubject).flat();
    gradeMutation.mutate({ questions: allQuestions, answers });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Loading view - LENORY generating questions
  if (view === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          {/* Anti-clockwise rotating timer circle */}
          <div className="mb-12 relative w-48 h-48 mx-auto">
            {/* Background circle */}
            <svg className="w-full h-full" viewBox="0 0 200 200">
              {/* Static background circle */}
              <circle cx="100" cy="100" r="95" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
              
              {/* Rotating progress circle (anti-clockwise) */}
              <circle
                cx="100"
                cy="100"
                r="95"
                fill="none"
                stroke="url(#gradient)"
                strokeWidth="3"
                strokeDasharray={`${(loadingProgress / 100) * 597} 597`}
                strokeLinecap="round"
                style={{
                  transform: 'rotate(-90deg)',
                  transformOrigin: '100px 100px',
                  transition: 'stroke-dasharray 0.3s ease',
                }}
              />
              
              {/* Gradient definition */}
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>

            {/* Center text - percentage */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-5xl font-bold text-white">{Math.min(loadingProgress, 100)}%</div>
              <div className="text-xs text-blue-300 mt-1">Preparing Exam</div>
            </div>
          </div>

          {/* Message */}
          <div className="space-y-4 mb-12">
            <h2 className="text-3xl font-bold text-white">
              LENORY Getting Your Questions Ready
            </h2>
            <p className="text-lg text-blue-200">
              Please wait for the exam to start...
            </p>
            <p className="text-sm text-blue-300 mt-4">
              Generating {selectedSubjects.length * 50} questions across {selectedSubjects.length} subject{selectedSubjects.length > 1 ? 's' : ''} for {selectedExamType}
            </p>
          </div>

          {/* Subject indicators */}
          <div className="space-y-2">
            <p className="text-xs text-blue-300 uppercase tracking-widest">Subjects</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {selectedSubjects.map((subject) => (
                <span
                  key={subject}
                  className="px-3 py-1 bg-blue-600 text-white text-xs rounded-full animate-pulse"
                >
                  {subject}
                </span>
              ))}
            </div>
          </div>

          {/* Animated dots */}
          <div className="mt-12 flex justify-center gap-2">
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></span>
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
          </div>
        </div>
      </div>
    );
  }

  // Results view
  if (view === 'results' && examResult) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-secondary/5 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-4xl font-bold flex items-center gap-3">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
              LENORY Results
            </h1>
            <Badge className="px-4 py-2 text-lg bg-green-600">{examResult.score}%</Badge>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <Card className="p-6">
              <p className="text-sm text-muted-foreground mb-2">Your Score</p>
              <p className="text-3xl font-bold text-green-600">{examResult.score}%</p>
            </Card>
            <Card className="p-6">
              <p className="text-sm text-muted-foreground mb-2">Strong Topics</p>
              <p className="text-sm font-medium">{examResult.strongTopics?.join(', ') || 'None'}</p>
            </Card>
            <Card className="p-6">
              <p className="text-sm text-muted-foreground mb-2">Weak Topics</p>
              <p className="text-sm text-red-600 font-medium">{examResult.weakTopics?.join(', ') || 'None'}</p>
            </Card>
          </div>

          <Card className="p-6 mb-8 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
            <p className="text-lg font-bold mb-4 flex items-center gap-2">
              💡 LENORY Recommendations
            </p>
            <ul className="space-y-2">
              {examResult.recommendations?.map((rec: string, idx: number) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-blue-600 dark:text-blue-400 font-bold">→</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex gap-4">
            <Button onClick={() => { setView('dashboard'); setExamResult(null); }} className="flex-1">
              Back to Dashboard
            </Button>
            <Button onClick={() => setView('history')} variant="outline" className="flex-1">
              View History
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Exam configuration view
  if (view === 'config') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-secondary/5 p-8">
        <div className="max-w-2xl mx-auto">
          <Button onClick={() => setView('dashboard')} variant="outline" className="mb-8">← Back</Button>
          
          <h1 className="text-4xl font-bold mb-2">Configure Exam</h1>
          <p className="text-muted-foreground mb-8">Select exam type and subjects. LENORY will generate 50 questions per subject.</p>

          <Card className="p-6 space-y-6">
            {/* Exam Type Selection */}
            <div>
              <label className="font-bold mb-3 block">Exam Type</label>
              <Select value={selectedExamType} onValueChange={(value) => {
                setSelectedExamType(value);
                setSelectedSubjects([]);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select exam type..." />
                </SelectTrigger>
                <SelectContent>
                  {EXAM_TYPES.map((exam) => (
                    <SelectItem key={exam} value={exam}>{exam}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Subject Selection */}
            {selectedExamType && (
              <div>
                <label className="font-bold mb-3 block">Subjects (Select Multiple)</label>
                <div className="space-y-2">
                  {SUBJECTS[selectedExamType]?.map((subject) => (
                    <label key={subject} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-secondary">
                      <input
                        type="checkbox"
                        checked={selectedSubjects.includes(subject)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedSubjects([...selectedSubjects, subject]);
                          } else {
                            setSelectedSubjects(selectedSubjects.filter((s) => s !== subject));
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="font-medium">{subject}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Exam Summary */}
            {selectedSubjects.length > 0 && (
              <Card className="p-4 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                <p className="font-bold mb-2">📋 Exam Summary</p>
                <p className="text-sm">Exam Type: <strong>{selectedExamType}</strong></p>
                <p className="text-sm">Subjects: <strong>{selectedSubjects.join(', ')}</strong></p>
                <p className="text-sm mt-2">Total Questions: <strong>{selectedSubjects.length * 50}</strong> (50 per subject)</p>
                <p className="text-sm">Time Limit: <strong>30 minutes</strong></p>
              </Card>
            )}

            <Button
              onClick={handleStartExam}
              disabled={isLoadingQuestions || selectedSubjects.length === 0}
              className="w-full text-lg py-6"
            >
              {isLoadingQuestions ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Questions with LENORY...
                </>
              ) : (
                '▶ Start Exam'
              )}
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  // Exam interface
  if (view === 'exam' && isExamActive && selectedSubjects.length > 0) {
    const currentSubject = selectedSubjects[currentSubjectIndex];
    const questions = questionsBySubject[currentSubject] || [];
    const currentQuestion = questions[currentQuestionIndex];
    const questionKey = `${currentSubject}_${currentQuestionIndex}`;

    return (
      <div className="min-h-screen bg-slate-950 p-4 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 text-white">
          <div className="flex-1">
            <h1 className="text-2xl font-bold">LENORY CBT</h1>
            <p className="text-sm text-slate-400">{selectedExamType}</p>
          </div>

          {/* Subject Tabs */}
          {selectedSubjects.length > 1 && (
            <div className="flex gap-2 mx-8">
              {selectedSubjects.map((subject, idx) => (
                <button
                  key={subject}
                  onClick={() => {
                    setCurrentSubjectIndex(idx);
                    setCurrentQuestionIndex(0);
                  }}
                  className={`px-4 py-2 rounded transition-all ${
                    currentSubjectIndex === idx
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {subject}
                </button>
              ))}
            </div>
          )}

          {/* Timer */}
          <div className="flex items-center gap-4 text-right">
            <Clock className="w-5 h-5" />
            <span className={`text-2xl font-mono font-bold ${timeRemaining < 300 ? 'text-red-500' : 'text-green-400'}`}>
              {formatTime(timeRemaining)}
            </span>
          </div>
        </div>

        <div className="flex gap-8 flex-1">
          {/* Question Tracker Sidebar */}
          <div className="w-32 bg-slate-800 rounded-lg p-4 overflow-y-auto">
            <p className="text-white text-xs font-bold mb-3 sticky top-0">Questions</p>
            <div className="grid grid-cols-4 gap-2">
              {questions.map((q, idx) => {
                const qKey = `${currentSubject}_${idx}`;
                return (
                  <button
                    key={idx}
                    onClick={() => setCurrentQuestionIndex(idx)}
                    className={`w-8 h-8 rounded text-xs font-bold transition-all ${
                      answers[qKey]
                        ? 'bg-green-500 text-white'
                        : currentQuestionIndex === idx
                        ? 'bg-blue-500 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {answers[qKey] ? '✓' : idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Question Area */}
          <div className="flex-1">
            {currentQuestion ? (
              <>
                <Card className="bg-white dark:bg-slate-800 p-8 mb-6">
                  <p className="text-sm text-muted-foreground mb-2">
                    {currentSubject} • Question {currentQuestionIndex + 1} of {questions.length}
                  </p>
                  <h2 className="text-2xl font-bold mb-6">{currentQuestion.question}</h2>
                  <div className="space-y-3">
                    {currentQuestion.options.map((option: string, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setAnswers((prev) => ({
                            ...prev,
                            [questionKey]: String.fromCharCode(65 + idx),
                          }));
                          if (currentQuestionIndex < questions.length - 1) {
                            setCurrentQuestionIndex(currentQuestionIndex + 1);
                          }
                        }}
                        className={`w-full p-4 border-2 rounded-lg text-left transition-all ${
                          answers[questionKey] === String.fromCharCode(65 + idx)
                            ? 'border-green-500 bg-green-50 dark:bg-green-950'
                            : 'border-slate-300 dark:border-slate-600 hover:border-slate-400'
                        }`}
                      >
                        <span className="font-bold">{String.fromCharCode(65 + idx)}.</span> {option}
                      </button>
                    ))}
                  </div>
                </Card>

                <div className="flex gap-4">
                  <Button
                    onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
                    disabled={currentQuestionIndex === 0}
                    variant="outline"
                    className="flex-1"
                  >
                    ← Previous
                  </Button>
                  <Button
                    onClick={() => setCurrentQuestionIndex(Math.min(questions.length - 1, currentQuestionIndex + 1))}
                    disabled={currentQuestionIndex === questions.length - 1}
                    variant="outline"
                    className="flex-1"
                  >
                    Next →
                  </Button>
                  <Button onClick={handleSubmitExam} className="flex-1 bg-green-600 hover:bg-green-700">
                    Submit (ESC)
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-white">
                <Loader2 className="w-8 h-8 animate-spin mr-2" />
                Loading questions...
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // History view
  if (view === 'history') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-secondary/5 p-8">
        <div className="max-w-4xl mx-auto">
          <Button onClick={() => setView('dashboard')} variant="outline" className="mb-8">← Back</Button>
          <h1 className="text-4xl font-bold flex items-center gap-3 mb-8">
            <History className="w-10 h-10" />
            Exam History
          </h1>

          {examHistory?.length ? (
            <div className="space-y-4">
              {examHistory.map((exam: any) => (
                <Card key={exam.id} className="p-6 hover:bg-secondary transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-bold text-lg">{exam.examType} - {exam.subjects?.join(', ')}</p>
                      <p className="text-sm text-muted-foreground">{new Date(exam.createdAt).toLocaleDateString()}</p>
                      <p className="mt-2 text-sm">{exam.summary}</p>
                    </div>
                    <Badge className="text-lg px-4 py-2">{exam.score}%</Badge>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-8 text-center text-muted-foreground">
              <p>No exam history yet. Start your first exam to begin!</p>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // Analytics view
  if (view === 'analytics') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-secondary/5 p-8">
        <div className="max-w-4xl mx-auto">
          <Button onClick={() => setView('dashboard')} variant="outline" className="mb-8">← Back</Button>
          <h1 className="text-4xl font-bold flex items-center gap-3 mb-8">
            <TrendingUp className="w-10 h-10" />
            Performance Analytics
          </h1>

          {analytics?.length ? (
            <div className="grid md:grid-cols-2 gap-6">
              {analytics.map((stat: any) => (
                <Card key={stat.id} className="p-6 hover:bg-secondary transition-colors">
                  <p className="font-bold">{stat.subject} - {stat.topic}</p>
                  <p className="text-sm text-muted-foreground">Attempts: {stat.attemptCount}</p>
                  <p className="text-2xl font-bold mt-2 text-green-600">{stat.averageScore}%</p>
                  <Badge className="mt-2">{stat.strengthLevel}</Badge>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-8 text-center text-muted-foreground">
              <p>No analytics data yet. Complete an exam to see your performance!</p>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // Dashboard
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/5 p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
          <BookOpen className="w-10 h-10 text-blue-500" />
          LENORY CBT Mode
        </h1>
        <p className="text-muted-foreground mb-8">
          AI-Powered Exam Simulation • Real-Time Question Generation • Intelligent Grading
        </p>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Start Exam Card */}
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-blue-500" />
              Take Exam
            </h2>
            <p className="text-muted-foreground mb-6">
              Select your exam type and subjects. LENORY generates real questions and intelligently grades your answers.
            </p>
            <Button onClick={() => setView('config')} className="w-full text-lg py-6">
              Start New Exam
            </Button>
          </Card>

          <div className="space-y-4">
            <Card className="p-6 cursor-pointer hover:bg-secondary transition-colors" onClick={() => setView('history')}>
              <h3 className="font-bold mb-2 flex items-center gap-2">
                <History className="w-4 h-4" />
                Exam History
              </h3>
              <p className="text-sm text-muted-foreground">{examHistory?.length || 0} exams completed</p>
            </Card>
            <Card className="p-6 cursor-pointer hover:bg-secondary transition-colors" onClick={() => setView('analytics')}>
              <h3 className="font-bold mb-2 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Performance Analytics
              </h3>
              <p className="text-sm text-muted-foreground">Track your progress by topic</p>
            </Card>
          </div>
        </div>

        {/* Features */}
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          <Card className="p-6">
            <p className="text-lg font-bold mb-2">🤖 Smart Generation</p>
            <p className="text-sm text-muted-foreground">LENORY AI generates 50+ questions per subject</p>
          </Card>
          <Card className="p-6">
            <p className="text-lg font-bold mb-2">📊 Instant Grading</p>
            <p className="text-sm text-muted-foreground">Get immediate feedback and recommendations</p>
          </Card>
          <Card className="p-6">
            <p className="text-lg font-bold mb-2">📈 Performance Tracking</p>
            <p className="text-sm text-muted-foreground">Monitor your progress across all topics</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
