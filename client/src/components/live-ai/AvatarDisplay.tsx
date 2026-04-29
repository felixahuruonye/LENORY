import { useEffect, useRef } from "react";

interface AvatarDisplayProps {
  voice: "female" | "male";
  isActive: boolean;
  isListening: boolean;
  isMouthOpen?: boolean;
}

export function AvatarDisplay({ voice, isActive, isListening, isMouthOpen = false }: AvatarDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let mouthOpen = isMouthOpen;
    let blinkCounter = 0;
    let eyesClosed = false;

    const drawAvatar = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Head - realistic skin tone
      const skinTone = voice === "female" ? "#f4c2a0" : "#d4a574";
      ctx.fillStyle = skinTone;
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2, canvas.height / 2 - 10, 70, 85, 0, 0, Math.PI * 2);
      ctx.fill();

      // Neck
      ctx.fillStyle = skinTone;
      ctx.fillRect(canvas.width / 2 - 25, canvas.height / 2 + 60, 50, 40);

      // Hair
      const hairColor = voice === "female" ? "#8B4513" : "#5C4033";
      ctx.fillStyle = hairColor;
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2 - 80, 75, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.fill();

      // Ears
      ctx.strokeStyle = skinTone;
      ctx.lineWidth = 2;
      ctx.fillStyle = "#E8B5A0";
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2 - 75, canvas.height / 2 - 20, 12, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2 + 75, canvas.height / 2 - 20, 12, 20, 0, 0, Math.PI * 2);
      ctx.fill();

      // Eyes - animate blink
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2 - 25, canvas.height / 2 - 25, 15, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2 + 25, canvas.height / 2 - 25, 15, 20, 0, 0, Math.PI * 2);
      ctx.fill();

      if (!eyesClosed) {
        ctx.fillStyle = "#4A90E2";
        ctx.beginPath();
        ctx.arc(canvas.width / 2 - 25, canvas.height / 2 - 25, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(canvas.width / 2 + 25, canvas.height / 2 - 25, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(canvas.width / 2 - 25, canvas.height / 2 - 25, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(canvas.width / 2 + 25, canvas.height / 2 - 25, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(canvas.width / 2 - 22, canvas.height / 2 - 27, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(canvas.width / 2 + 28, canvas.height / 2 - 27, 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Closed eyes
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2 - 33, canvas.height / 2 - 25);
        ctx.lineTo(canvas.width / 2 - 17, canvas.height / 2 - 25);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2 + 17, canvas.height / 2 - 25);
        ctx.lineTo(canvas.width / 2 + 33, canvas.height / 2 - 25);
        ctx.stroke();
      }

      // Eyebrows
      ctx.strokeStyle = hairColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 - 35, canvas.height / 2 - 45);
      ctx.lineTo(canvas.width / 2 - 15, canvas.height / 2 - 48);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 + 15, canvas.height / 2 - 48);
      ctx.lineTo(canvas.width / 2 + 35, canvas.height / 2 - 45);
      ctx.stroke();

      // Nose
      ctx.strokeStyle = "#D4A574";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, canvas.height / 2 - 15);
      ctx.lineTo(canvas.width / 2, canvas.height / 2 + 5);
      ctx.stroke();

      // Mouth - animate ONLY when actively speaking
      ctx.strokeStyle = voice === "female" ? "#E75480" : "#B8604B";
      ctx.lineWidth = 2;
      ctx.beginPath();

      if (mouthOpen && isActive) {
        // Open mouth when speaking
        ctx.ellipse(canvas.width / 2, canvas.height / 2 + 25, 20, 15, 0, 0, Math.PI);
        ctx.fillStyle = "#8B3A3A";
        ctx.fill();
      } else {
        // Closed mouth - slight smile
        ctx.moveTo(canvas.width / 2 - 20, canvas.height / 2 + 25);
        ctx.quadraticCurveTo(canvas.width / 2, canvas.height / 2 + 30, canvas.width / 2 + 20, canvas.height / 2 + 25);
      }
      ctx.stroke();

      // Blinking animation
      blinkCounter++;
      if (blinkCounter > 150) {
        eyesClosed = true;
        if (blinkCounter > 160) {
          eyesClosed = false;
          blinkCounter = 0;
        }
      }

      // Mouth animation ONLY when actively speaking (isActive = isSpeaking)
      if (isActive) {
        mouthOpen = !mouthOpen;
      } else {
        mouthOpen = false;
      }

      animationRef.current = requestAnimationFrame(drawAvatar);
    };

    drawAvatar();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [voice, isListening, isActive, isMouthOpen]);

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas
        ref={canvasRef}
        width={280}
        height={380}
        className="drop-shadow-2xl"
        data-testid="avatar-canvas"
      />
      <div className={`text-center ${isActive ? "animate-pulse" : ""}`}>
        <p className="text-sm font-semibold text-purple-300">
          {isActive ? "LENORY AI Tutor" : "Starting..."}
        </p>
        <p className="text-xs text-slate-400">
          {isListening ? "🎤 Listening..." : "Ready to help"}
        </p>
      </div>
    </div>
  );
}
