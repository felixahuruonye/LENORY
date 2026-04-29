import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollReveal } from "@/components/ScrollReveal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { InstallPrompt, InstallButton } from "@/components/InstallPrompt";
import {
  Mic,
  Brain,
  BookOpen,
  GraduationCap,
  Zap,
  ArrowRight,
  CheckCircle,
  Users,
  TrendingUp,
  Globe,
  Download,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export default function Landing() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentFeature, setCurrentFeature] = useState(0);

  // Simple canvas animation for hero background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
    }> = [];

    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 2 + 1,
      });
    }

    let animationId: number;
    const animate = () => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      particles.forEach((particle, i) => {
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1;
        if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(262, 83%, ${58 + Math.sin(Date.now() * 0.001 + i) * 10}%)`;
        ctx.fill();

        particles.forEach((other, j) => {
          if (i === j) return;
          const dx = particle.x - other.x;
          const dy = particle.y - other.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 100) {
            ctx.beginPath();
            ctx.moveTo(particle.x, particle.y);
            ctx.lineTo(other.x, other.y);
            ctx.strokeStyle = `hsla(262, 83%, 58%, ${1 - distance / 100})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        });
      });

      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      cancelAnimationFrame(animationId);
    };
  }, []);

  const features = [
    {
      icon: Mic,
      title: "Voice-First Learning",
      description: "Record live sessions with real-time AI transcription and speaker detection",
    },
    {
      icon: Brain,
      title: "AI-Powered Tutoring",
      description: "Get instant answers with text and voice responses from advanced AI",
    },
    {
      icon: BookOpen,
      title: "Smart Course Builder",
      description: "Generate complete syllabi and lessons from simple topic inputs",
    },
    {
      icon: GraduationCap,
      title: "CBT Exam System",
      description: "Create and take computer-based tests with auto-grading",
    },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentFeature((prev) => (prev + 1) % features.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 backdrop-blur-lg bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
                <Zap className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl sm:text-2xl font-display font-bold bg-gradient-to-r from-primary to-chart-2 bg-clip-text text-transparent">
                LENORY
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <ThemeToggle />
              <Button
                asChild
                variant="ghost"
                className="hover-elevate active-elevate-2"
                data-testid="button-login"
              >
                <Link href="/login">Log In</Link>
              </Button>
              <Button
                asChild
                className="hover-elevate active-elevate-2"
                data-testid="button-get-started"
              >
                <Link href="/signup">Get Started</Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16 sm:pt-20">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ opacity: 0.3 }}
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20 text-center">
          <ScrollReveal>
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-display font-bold mb-6 bg-gradient-to-r from-primary via-chart-2 to-chart-3 bg-clip-text text-transparent leading-tight">
              The Future of Learning
              <br />
              <span className="text-3xl sm:text-5xl lg:text-6xl">Starts with Your Voice</span>
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={100}>
            <p className="text-lg sm:text-xl lg:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto">
              Experience AI-powered education with real-time voice transcription,
              intelligent tutoring, and personalized learning paths designed for African students.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={200}>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Button
                asChild
                size="lg"
                className="h-12 px-8 text-lg hover-elevate active-elevate-2 group"
                data-testid="button-start-learning"
              >
                <Link href="/signup">
                  Start Learning
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <InstallButton />
            </div>
          </ScrollReveal>

          {/* Floating Feature Cards */}
          <div className="mt-16 sm:mt-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {features.map((feature, index) => (
              <ScrollReveal key={index} delay={300 + index * 100}>
                <Card
                  className={`p-6 hover-elevate active-elevate-2 cursor-pointer transition-all duration-300 ${
                    currentFeature === index ? "ring-2 ring-primary" : ""
                  }`}
                  data-testid={`card-feature-${index}`}
                >
                  <feature.icon className="h-10 w-10 text-primary mb-4" />
                  <h3 className="font-display font-semibold text-lg mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </Card>
              </ScrollReveal>
            ))}
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="h-12 w-8 rounded-full border-2 border-primary/50 flex items-start justify-center p-2">
            <div className="h-2 w-2 rounded-full bg-primary" />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 sm:py-32 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-center mb-4">
              Powerful Features for Modern Learning
            </h2>
          </ScrollReveal>
          <ScrollReveal delay={100}>
            <p className="text-lg sm:text-xl text-muted-foreground text-center mb-16 max-w-3xl mx-auto">
              Everything you need to succeed in your educational journey
            </p>
          </ScrollReveal>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12">
            <ScrollReveal delay={200}>
              <Card className="p-8 hover-elevate active-elevate-2">
                <Mic className="h-12 w-12 text-primary mb-6" />
                <h3 className="text-2xl font-display font-semibold mb-4">
                  Live Voice Classroom
                </h3>
                <p className="text-muted-foreground mb-6">
                  Record lectures with real-time AI transcription. Speaker detection,
                  timestamps, and automatic lesson generation from your voice recordings.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <span className="text-sm">Real-time speech-to-text with 95%+ accuracy</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <span className="text-sm">Multi-speaker detection and labeling</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <span className="text-sm">Clickable timestamps for easy navigation</span>
                  </li>
                </ul>
              </Card>
            </ScrollReveal>

            <ScrollReveal delay={300}>
              <Card className="p-8 hover-elevate active-elevate-2">
                <Brain className="h-12 w-12 text-chart-2 mb-6" />
                <h3 className="text-2xl font-display font-semibold mb-4">
                  AI Tutor Chat
                </h3>
                <p className="text-muted-foreground mb-6">
                  Get instant help from an advanced AI tutor. Ask questions via text or voice,
                  upload documents, and receive comprehensive explanations.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-chart-2 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">Text and voice input support</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-chart-2 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">Upload PDFs, images, and documents</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-chart-2 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">Math rendering and code syntax highlighting</span>
                  </li>
                </ul>
              </Card>
            </ScrollReveal>

            <ScrollReveal delay={400}>
              <Card className="p-8 hover-elevate active-elevate-2">
                <BookOpen className="h-12 w-12 text-chart-3 mb-6" />
                <h3 className="text-2xl font-display font-semibold mb-4">
                  Smart Course Builder
                </h3>
                <p className="text-muted-foreground mb-6">
                  Create comprehensive courses from simple topics. AI generates complete
                  syllabi, lesson plans, and learning resources automatically.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-chart-3 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">AI-generated course syllabi</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-chart-3 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">Drag-and-drop lesson organization</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-chart-3 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">Rich media support and previews</span>
                  </li>
                </ul>
              </Card>
            </ScrollReveal>

            <ScrollReveal delay={500}>
              <Card className="p-8 hover-elevate active-elevate-2">
                <GraduationCap className="h-12 w-12 text-chart-4 mb-6" />
                <h3 className="text-2xl font-display font-semibold mb-4">
                  CBT Exam System
                </h3>
                <p className="text-muted-foreground mb-6">
                  Computer-based testing with auto-grading, detailed analytics, and
                  personalized feedback to track student progress.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-chart-4 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">Full-screen exam environment</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-chart-4 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">AI-powered auto-grading with rubrics</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-chart-4 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">Detailed performance analytics</span>
                  </li>
                </ul>
              </Card>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 sm:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
            <ScrollReveal>
              <div className="text-center">
                <Users className="h-12 w-12 text-primary mx-auto mb-4" />
                <div className="text-4xl sm:text-5xl font-display font-bold text-primary mb-2">
                  10,000+
                </div>
                <div className="text-muted-foreground">Active Students</div>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={100}>
              <div className="text-center">
                <TrendingUp className="h-12 w-12 text-chart-2 mx-auto mb-4" />
                <div className="text-4xl sm:text-5xl font-display font-bold text-chart-2 mb-2">
                  95%
                </div>
                <div className="text-muted-foreground">Pass Rate</div>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={200}>
              <div className="text-center">
                <Globe className="h-12 w-12 text-chart-3 mx-auto mb-4" />
                <div className="text-4xl sm:text-5xl font-display font-bold text-chart-3 mb-2">
                  50+
                </div>
                <div className="text-muted-foreground">Partner Schools</div>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 sm:py-32 bg-gradient-to-r from-primary/10 via-chart-2/10 to-chart-3/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <ScrollReveal>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold mb-6">
              Ready to Transform Your Learning?
            </h2>
          </ScrollReveal>
          <ScrollReveal delay={100}>
            <p className="text-lg sm:text-xl text-muted-foreground mb-8">
              Join thousands of students and educators using LENORY to achieve their goals
            </p>
          </ScrollReveal>
          <ScrollReveal delay={200}>
            <Button
              asChild
              size="lg"
              className="h-14 px-12 text-lg hover-elevate active-elevate-2 group"
              data-testid="button-get-started-footer"
            >
              <Link href="/signup">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          </ScrollReveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-primary-foreground" />
                </div>
                <span className="text-xl font-display font-bold">LENORY</span>
              </div>
              <p className="text-sm text-muted-foreground">
                The future of voice-first AI learning for African students
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Product</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">For Schools</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Company</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">About</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Careers</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Legal</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Privacy</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Terms</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Academic Integrity</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-border text-center text-sm text-muted-foreground">
            © 2025 LENORY. Built for the future of education.
          </div>
        </div>
      </footer>

      {/* PWA Install Prompt */}
      <InstallPrompt />
    </div>
  );
}
