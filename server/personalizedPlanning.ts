// Personalized Study Planning Engine
// Generates custom study plans based on user profile

export interface StudyPlan {
  planId: string;
  userId: string;
  examType: "jamb" | "waec" | "neco" | "university" | "custom";
  deadline: Date;
  totalDaysAvailable: number;
  hoursPerDay: number;
  subjects: string[];
  weakTopics: string[];
  schedule: DailyPlan[];
  totalHoursRequired: number;
  statusPercentage: number;
}

export interface DailyPlan {
  date: Date;
  dayNumber: number;
  tasks: StudyTask[];
  estimatedHours: number;
}

export interface StudyTask {
  taskId: string;
  subject: string;
  topic: string;
  activity: "lesson" | "practice" | "quiz" | "revision" | "mockexam";
  durationMinutes: number;
  difficulty: "easy" | "medium" | "hard";
  priority: "high" | "medium" | "low";
  completed: boolean;
}

/**
 * Generate a personalized study plan
 */
export function generateStudyPlan(userProfile: any): StudyPlan {
  const {
    examType,
    deadline,
    hoursAvailable,
    hoursPerDay,
    subjects,
    weakTopics,
    strength,
  } = userProfile;

  const today = new Date();
  const deadlineDate = new Date(deadline);
  const totalDays = Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const plan: StudyPlan = {
    planId: "plan-" + Date.now(),
    userId: userProfile.userId,
    examType,
    deadline: deadlineDate,
    totalDaysAvailable: totalDays,
    hoursPerDay,
    subjects,
    weakTopics,
    schedule: [],
    totalHoursRequired: hoursAvailable,
    statusPercentage: 0,
  };

  // Generate daily plans
  for (let day = 1; day <= totalDays; day++) {
    const currentDate = new Date(today);
    currentDate.setDate(currentDate.getDate() + day - 1);

    const dailyTasks = generateDailyTasks(
      day,
      totalDays,
      subjects,
      weakTopics,
      hoursPerDay,
      strength
    );

    const dailyPlan: DailyPlan = {
      date: currentDate,
      dayNumber: day,
      tasks: dailyTasks,
      estimatedHours: dailyTasks.reduce((sum, t) => sum + t.durationMinutes / 60, 0),
    };

    plan.schedule.push(dailyPlan);
  }

  return plan;
}

/**
 * Generate daily study tasks
 */
export function generateDailyTasks(
  dayNumber: number,
  totalDays: number,
  subjects: string[],
  weakTopics: string[],
  hoursPerDay: number,
  strength: "beginner" | "intermediate" | "advanced"
): StudyTask[] {
  const tasks: StudyTask[] = [];
  const minutesPerDay = hoursPerDay * 60;
  let minutesAllocated = 0;

  // Distribute subjects throughout the plan
  const subjectIndex = (dayNumber - 1) % subjects.length;
  const currentSubject = subjects[subjectIndex];

  // Days 1-20%: Fundamentals and weak topics
  if (dayNumber <= totalDays * 0.2) {
    tasks.push({
      taskId: `task-${dayNumber}-1`,
      subject: currentSubject,
      topic: weakTopics[Math.floor(Math.random() * weakTopics.length)] || "General Revision",
      activity: "lesson",
      durationMinutes: Math.floor(minutesPerDay * 0.5),
      difficulty: "easy",
      priority: "high",
      completed: false,
    });

    tasks.push({
      taskId: `task-${dayNumber}-2`,
      subject: currentSubject,
      topic: weakTopics[Math.floor(Math.random() * weakTopics.length)] || "General Practice",
      activity: "practice",
      durationMinutes: Math.floor(minutesPerDay * 0.5),
      difficulty: "easy",
      priority: "high",
      completed: false,
    });
  }
  // Days 20-60%: Build depth and practice
  else if (dayNumber <= totalDays * 0.6) {
    tasks.push({
      taskId: `task-${dayNumber}-1`,
      subject: currentSubject,
      topic: `Advanced Topics in ${currentSubject}`,
      activity: "lesson",
      durationMinutes: Math.floor(minutesPerDay * 0.4),
      difficulty: "medium",
      priority: "high",
      completed: false,
    });

    tasks.push({
      taskId: `task-${dayNumber}-2`,
      subject: currentSubject,
      topic: `Practice ${currentSubject}`,
      activity: "practice",
      durationMinutes: Math.floor(minutesPerDay * 0.35),
      difficulty: "medium",
      priority: "high",
      completed: false,
    });

    if (dayNumber % 5 === 0) {
      tasks.push({
        taskId: `task-${dayNumber}-3`,
        subject: currentSubject,
        topic: `Quiz: ${currentSubject}`,
        activity: "quiz",
        durationMinutes: Math.floor(minutesPerDay * 0.25),
        difficulty: "medium",
        priority: "medium",
        completed: false,
      });
    }
  }
  // Days 60-85%: Consolidation and mock exams
  else if (dayNumber <= totalDays * 0.85) {
    tasks.push({
      taskId: `task-${dayNumber}-1`,
      subject: "General",
      topic: "Mix of All Subjects",
      activity: "mockexam",
      durationMinutes: Math.floor(minutesPerDay * 0.7),
      difficulty: "hard",
      priority: "high",
      completed: false,
    });

    tasks.push({
      taskId: `task-${dayNumber}-2`,
      subject: currentSubject,
      topic: "Weak Area Focus",
      activity: "practice",
      durationMinutes: Math.floor(minutesPerDay * 0.3),
      difficulty: "hard",
      priority: "high",
      completed: false,
    });
  }
  // Final days: Revision and confidence building
  else {
    tasks.push({
      taskId: `task-${dayNumber}-1`,
      subject: "General",
      topic: "Final Revision All Topics",
      activity: "revision",
      durationMinutes: Math.floor(minutesPerDay * 0.6),
      difficulty: "medium",
      priority: "high",
      completed: false,
    });

    tasks.push({
      taskId: `task-${dayNumber}-2`,
      subject: "General",
      topic: "Confidence Building",
      activity: "mockexam",
      durationMinutes: Math.floor(minutesPerDay * 0.4),
      difficulty: "medium",
      priority: "medium",
      completed: false,
    });
  }

  return tasks;
}

/**
 * Calculate time remaining and pace recommendation
 */
export function getPaceRecommendation(
  plan: StudyPlan,
  daysElapsed: number,
  hoursCompleted: number
): {
  status: "on_track" | "behind" | "ahead";
  recommendation: string;
  hoursNeededPerDay: number;
} {
  const totalHoursInPlan = plan.schedule.reduce((sum, day) => sum + day.estimatedHours, 0);
  const expectedHours = (daysElapsed / plan.totalDaysAvailable) * totalHoursInPlan;
  const hoursRemaining = totalHoursInPlan - hoursCompleted;
  const daysRemaining = plan.totalDaysAvailable - daysElapsed;
  const requiredHoursPerDay = hoursRemaining / daysRemaining;

  if (hoursCompleted >= expectedHours) {
    return {
      status: "on_track",
      recommendation: `Great! You're on track. Maintain ${plan.hoursPerDay} hours/day to finish on time.`,
      hoursNeededPerDay: plan.hoursPerDay,
    };
  } else if (hoursCompleted >= expectedHours * 0.8) {
    return {
      status: "behind" as const,
      recommendation: `You're slightly behind. Increase to ${Math.ceil(requiredHoursPerDay)} hours/day to stay on schedule.`,
      hoursNeededPerDay: Math.ceil(requiredHoursPerDay),
    };
  } else {
    return {
      status: "behind",
      recommendation: `You're behind schedule! Urgent: Increase to ${Math.ceil(requiredHoursPerDay + 1)} hours/day minimum.`,
      hoursNeededPerDay: Math.ceil(requiredHoursPerDay + 1),
    };
  }
}
