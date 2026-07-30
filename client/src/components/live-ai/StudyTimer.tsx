import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Play, Pause, RotateCcw , Circle } from "lucide-react";

interface StudyTimerProps {
  onTick?: (seconds: number) => void;
}

export function StudyTimer({ onTick }: StudyTimerProps) {
  const [minutes, setMinutes] = useState(25);
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [sessions, setSessions] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isRunning) {
      interval = setInterval(() => {
        if (seconds > 0) {
          setSeconds(seconds - 1);
          onTick?.(sessions * 1500 + (25 * 60 - (minutes * 60 + seconds)));
        } else if (minutes > 0) {
          setMinutes(minutes - 1);
          setSeconds(59);
        } else {
          // Timer finished
          setIsRunning(false);
          setSessions(sessions + 1);
          setMinutes(5); // Break time
        }
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [isRunning, minutes, seconds, sessions, onTick]);

  const reset = () => {
    setMinutes(25);
    setSeconds(0);
    setIsRunning(false);
  };

  const toggleTimer = () => {
    setIsRunning(!isRunning);
  };

  return (
    <Card className="p-4 bg-gradient-to-br from-purple-600/20 to-pink-600/20 border-purple-500/30">
      <div className="text-center">
        <p className="text-xs text-slate-400 mb-2">Pomodoro Timer</p>
        <div className="text-3xl font-bold text-white font-mono mb-3">
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </div>
        <div className="flex gap-2 justify-center mb-3">
          <Button
            size="sm"
            variant="default"
            onClick={toggleTimer}
            data-testid="button-timer-toggle"
            className="gap-1"
          >
            {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isRunning ? "Pause" : "Start"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={reset}
            data-testid="button-timer-reset"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-slate-300">
          Sessions Completed: {sessions}
        </p>
      </div>
    </Card>
  );
}

