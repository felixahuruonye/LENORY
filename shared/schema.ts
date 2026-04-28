import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  boolean,
  decimal,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum('user_role', ['student', 'teacher', 'admin', 'lecturer', 'school']);
export const sessionStatusEnum = pgEnum('session_status', ['active', 'paused', 'ended']);
export const quizDifficultyEnum = pgEnum('quiz_difficulty', ['easy', 'medium', 'hard']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'completed', 'failed']);
export const learningModeEnum = pgEnum('learning_mode', ['learning', 'exam', 'revision', 'quick', 'eli5', 'advanced', 'practice']);
export const examTypeEnum = pgEnum('exam_type', ['waec', 'neco', 'jamb', 'university', 'custom']);
export const notificationTypeEnum = pgEnum('notification_type', ['chat', 'chat_history', 'motivation', 'achievement', 'reminder', 'exam', 'study_plan', 'system']);

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table (required for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: userRoleEnum("role").default('student').notNull(),
  schoolId: varchar("school_id"),
  subscriptionTier: varchar("subscription_tier", { length: 50 }).default('free'),
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  paystackCustomerId: varchar("paystack_customer_id"),
  lernoryId: varchar("lernory_id").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Device sessions for trusted device auto-login
export const deviceSessions = pgTable("device_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceToken: varchar("device_token").notNull().unique(),
  deviceInfo: jsonb("device_info"),
  lastUsedAt: timestamp("last_used_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const upsertUserSchema = createInsertSchema(users).pick({
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
});

export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = typeof users.$inferSelect;

export const insertDeviceSessionSchema = createInsertSchema(deviceSessions).omit({ id: true, createdAt: true, lastUsedAt: true });
export type InsertDeviceSession = z.infer<typeof insertDeviceSessionSchema>;
export type DeviceSession = typeof deviceSessions.$inferSelect;

// Schools table (multi-tenant)
export const schools = pgTable("schools", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  domain: varchar("domain", { length: 255 }).unique(),
  settings: jsonb("settings"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSchoolSchema = createInsertSchema(schools).omit({ id: true, createdAt: true });
export type InsertSchool = z.infer<typeof insertSchoolSchema>;
export type School = typeof schools.$inferSelect;

// Student profiles
export const studentProfiles = pgTable("student_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  weakTopics: text("weak_topics").array(),
  completedCourses: text("completed_courses").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertStudentProfileSchema = createInsertSchema(studentProfiles).omit({ id: true, createdAt: true });
export type InsertStudentProfile = z.infer<typeof insertStudentProfileSchema>;
export type StudentProfile = typeof studentProfiles.$inferSelect;

// Courses
export const courses = pgTable("courses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  teacherId: varchar("teacher_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  syllabus: jsonb("syllabus"),
  price: decimal("price", { precision: 10, scale: 2 }).default('0'),
  isPublished: boolean("is_published").default(false).notNull(),
  schoolId: varchar("school_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCourseSchema = createInsertSchema(courses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof courses.$inferSelect;

// Lessons
export const lessons = pgTable("lessons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  courseId: varchar("course_id").references(() => courses.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  content: jsonb("content").notNull(),
  transcriptId: varchar("transcript_id"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLessonSchema = createInsertSchema(lessons).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLesson = z.infer<typeof insertLessonSchema>;
export type Lesson = typeof lessons.$inferSelect;

// Notifications
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum("type").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  icon: varchar("icon", { length: 50 }),
  actionUrl: varchar("action_url", { length: 512 }),
  read: boolean("read").default(false).notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [index("IDX_notification_user_id").on(table.userId), index("IDX_notification_created").on(table.createdAt)]);

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true, sentAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// Live sessions
export const liveSessions = pgTable("live_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  hostId: varchar("host_id").notNull().references(() => users.id),
  title: varchar("title", { length: 255 }).notNull(),
  status: sessionStatusEnum("status").default('active').notNull(),
  participants: text("participants").array(),
  settings: jsonb("settings"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});

export const insertLiveSessionSchema = createInsertSchema(liveSessions).omit({ id: true, startedAt: true, endedAt: true });
export type InsertLiveSession = z.infer<typeof insertLiveSessionSchema>;
export type LiveSession = typeof liveSessions.$inferSelect;

// Transcripts
export const transcripts = pgTable("transcripts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").references(() => liveSessions.id, { onDelete: 'cascade' }),
  segments: jsonb("segments").notNull(),
  audioUrl: text("audio_url"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTranscriptSchema = createInsertSchema(transcripts).omit({ id: true, createdAt: true });
export type InsertTranscript = z.infer<typeof insertTranscriptSchema>;
export type Transcript = typeof transcripts.$inferSelect;

// Quizzes/Exams
export const quizzes = pgTable("quizzes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  courseId: varchar("course_id").references(() => courses.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  difficulty: quizDifficultyEnum("difficulty").default('medium').notNull(),
  timeLimit: integer("time_limit"),
  questions: jsonb("questions").notNull(),
  rubric: jsonb("rubric"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertQuizSchema = createInsertSchema(quizzes).omit({ id: true, createdAt: true });
export type InsertQuiz = z.infer<typeof insertQuizSchema>;
export type Quiz = typeof quizzes.$inferSelect;

// Quiz attempts
export const quizAttempts = pgTable("quiz_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  quizId: varchar("quiz_id").notNull().references(() => quizzes.id, { onDelete: 'cascade' }),
  studentId: varchar("student_id").notNull().references(() => users.id),
  answers: jsonb("answers").notNull(),
  score: decimal("score", { precision: 5, scale: 2 }),
  feedback: jsonb("feedback"),
  completedAt: timestamp("completed_at").defaultNow().notNull(),
});

export const insertQuizAttemptSchema = createInsertSchema(quizAttempts).omit({ id: true, completedAt: true });
export type InsertQuizAttempt = z.infer<typeof insertQuizAttemptSchema>;
export type QuizAttempt = typeof quizAttempts.$inferSelect;

// Chat messages
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  sessionId: varchar("session_id").references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: varchar("role", { length: 50 }).notNull(),
  content: text("content").notNull(),
  attachments: jsonb("attachments"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

// Extended type for chat messages with proper attachment typing
export interface ChatMessageWithAttachments {
  id: string;
  userId: string;
  sessionId: string | null;
  role: string;
  content: string;
  attachments: {
    images?: Array<{
      url: string;
      title?: string;
    }>;
  } | null;
  createdAt: Date;
}

export type ChatMessage = typeof chatMessages.$inferSelect;

// Chat Sessions (for organizing conversations into chat history)
export const chatSessions = pgTable("chat_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  summary: text("summary"),
  mode: varchar("mode", { length: 50 }).default('chat'), // chat, writing, coding, image
  isBookmarked: boolean("is_bookmarked").default(false),
  messageCount: integer("message_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertChatSessionSchema = createInsertSchema(chatSessions).omit({ id: true, createdAt: true, updatedAt: true, messageCount: true });
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;
export type ChatSession = typeof chatSessions.$inferSelect;

// Memory entries (student performance tracking)
export const memoryEntries = pgTable("memory_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar("type", { length: 50 }).notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMemoryEntrySchema = createInsertSchema(memoryEntries).omit({ id: true, createdAt: true });
export type InsertMemoryEntry = z.infer<typeof insertMemoryEntrySchema>;
export type MemoryEntry = typeof memoryEntries.$inferSelect;

// Purchases (marketplace)
export const purchases = pgTable("purchases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  buyerId: varchar("buyer_id").notNull().references(() => users.id),
  courseId: varchar("course_id").notNull().references(() => courses.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentStatus: paymentStatusEnum("payment_status").default('pending').notNull(),
  paystackReference: varchar("paystack_reference", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPurchaseSchema = createInsertSchema(purchases).omit({ id: true, createdAt: true });
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type Purchase = typeof purchases.$inferSelect;

// Analytics events
export const analyticsEvents = pgTable("analytics_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  eventData: jsonb("event_data"),
  schoolId: varchar("school_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAnalyticsEventSchema = createInsertSchema(analyticsEvents).omit({ id: true, createdAt: true });
export type InsertAnalyticsEvent = z.infer<typeof insertAnalyticsEventSchema>;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;

// File uploads
export const fileUploads = pgTable("file_uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 50 }).notNull(),
  fileSize: integer("file_size").notNull(),
  fileUrl: text("file_url").notNull(),
  processingStatus: varchar("processing_status", { length: 50 }).default('pending').notNull(),
  extractedText: text("extracted_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFileUploadSchema = createInsertSchema(fileUploads).omit({ id: true, createdAt: true });
export type InsertFileUpload = z.infer<typeof insertFileUploadSchema>;
export type FileUpload = typeof fileUploads.$inferSelect;

// Study Plans
export const studyPlans = pgTable("study_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  subjects: text("subjects").array().notNull(),
  examType: examTypeEnum("exam_type"),
  deadline: timestamp("deadline"),
  hoursPerDay: integer("hours_per_day"),
  weakAreas: text("weak_areas").array(),
  schedule: jsonb("schedule"), // Daily breakdown
  progress: jsonb("progress"), // Tracking completion
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertStudyPlanSchema = createInsertSchema(studyPlans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStudyPlan = z.infer<typeof insertStudyPlanSchema>;
export type StudyPlan = typeof studyPlans.$inferSelect;

// User Progress & Learning History
export const userProgress = pgTable("user_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  subject: varchar("subject", { length: 100 }).notNull(),
  topicsStudied: text("topics_studied").array(),
  weakTopics: text("weak_topics").array(),
  strongTopics: text("strong_topics").array(),
  questionsAttempted: integer("questions_attempted").default(0),
  averageScore: decimal("average_score", { precision: 5, scale: 2 }).default('0'),
  learningMode: learningModeEnum("learning_mode").default('learning'),
  preferredLanguage: varchar("preferred_language", { length: 50 }).default('English'),
  lastStudiedAt: timestamp("last_studied_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserProgressSchema = createInsertSchema(userProgress).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserProgress = z.infer<typeof insertUserProgressSchema>;
export type UserProgress = typeof userProgress.$inferSelect;

// Code Snippets & Debugging
export const codeSnippets = pgTable("code_snippets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }),
  language: varchar("language", { length: 50 }).notNull(),
  code: text("code").notNull(),
  debugged: boolean("debugged").default(false),
  explanation: text("explanation"),
  fixedCode: text("fixed_code"),
  issues: jsonb("issues"), // Array of issues found
  learnings: text("learnings"), // Key points from debugging
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCodeSnippetSchema = createInsertSchema(codeSnippets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCodeSnippet = z.infer<typeof insertCodeSnippetSchema>;
export type CodeSnippet = typeof codeSnippets.$inferSelect;

// Exam Results & Performance Tracking
export const examResults = pgTable("exam_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  examName: varchar("exam_name", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 100 }),
  totalQuestions: integer("total_questions"),
  correctAnswers: integer("correct_answers"),
  score: decimal("score", { precision: 5, scale: 2 }),
  timeSpent: integer("time_spent"), // in minutes
  answers: jsonb("answers"), // User's answers with explanations
  topicsStrong: text("topics_strong").array(),
  topicsWeak: text("topics_weak").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertExamResultSchema = createInsertSchema(examResults).omit({ id: true, createdAt: true });
export type InsertExamResult = z.infer<typeof insertExamResultSchema>;
export type ExamResult = typeof examResults.$inferSelect;

// Generated Websites
export const generatedWebsites = pgTable("generated_websites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  prompt: text("prompt").notNull(),
  htmlCode: text("html_code").notNull(),
  cssCode: text("css_code").notNull(),
  jsCode: text("js_code"),
  previewUrl: text("preview_url"),
  tags: text("tags").array(),
  isFavorite: boolean("is_favorite").default(false),
  viewCount: integer("view_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertGeneratedWebsiteSchema = createInsertSchema(generatedWebsites).omit({ id: true, createdAt: true, updatedAt: true, viewCount: true });
export type InsertGeneratedWebsite = z.infer<typeof insertGeneratedWebsiteSchema>;
export type GeneratedWebsite = typeof generatedWebsites.$inferSelect;

// Learning History
export const learningHistory = pgTable("learning_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  subject: varchar("subject", { length: 100 }).notNull(),
  topic: varchar("topic", { length: 255 }).notNull(),
  mode: varchar("mode", { length: 50 }), // learning, exam, revision
  duration: integer("duration"), // in minutes
  performance: varchar("performance", { length: 20 }), // excellent, good, fair, poor
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLearningHistorySchema = createInsertSchema(learningHistory).omit({ id: true, createdAt: true });
export type InsertLearningHistory = z.infer<typeof insertLearningHistorySchema>;
export type LearningHistory = typeof learningHistory.$inferSelect;

// Generated Images
export const generatedImages = pgTable("generated_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  prompt: text("prompt").notNull(),
  imageUrl: text("image_url").notNull(),
  relatedTopic: varchar("related_topic", { length: 255 }),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertGeneratedImageSchema = createInsertSchema(generatedImages).omit({ id: true, createdAt: true });
export type InsertGeneratedImage = z.infer<typeof insertGeneratedImageSchema>;
export type GeneratedImage = typeof generatedImages.$inferSelect;

// Topic Explanations
export const topicExplanations = pgTable("topic_explanations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  subject: varchar("subject", { length: 100 }).notNull(),
  topic: varchar("topic", { length: 255 }).notNull(),
  explanation: text("explanation").notNull(),
  examples: jsonb("examples"),
  relatedTopics: text("related_topics").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTopicExplanationSchema = createInsertSchema(topicExplanations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTopicExplanation = z.infer<typeof insertTopicExplanationSchema>;
export type TopicExplanation = typeof topicExplanations.$inferSelect;

// Voice Conversations (LEARNORY LIVE AI)
export const voiceConversations = pgTable("voice_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  subject: varchar("subject", { length: 100 }),
  initialPrompt: text("initial_prompt"),
  turnCount: integer("turn_count").default(0),
  audioSegments: jsonb("audio_segments"), // Array of { role, audioUrl, transcript }
  currentPhase: varchar("current_phase", { length: 50 }), // tutoring, practice, assessment
  lastActivityAt: timestamp("last_activity_at"),
  isActive: boolean("is_active").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVoiceConversationSchema = createInsertSchema(voiceConversations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVoiceConversation = z.infer<typeof insertVoiceConversationSchema>;
export type VoiceConversation = typeof voiceConversations.$inferSelect;

// Document Uploads (for Gemini Vision API)
export const documentUploads = pgTable("document_uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  fileName: varchar("file_name").notNull(),
  fileType: varchar("file_type").notNull(), // pdf, image, docx, handwritten
  fileUrl: varchar("file_url").notNull(),
  fileSize: integer("file_size"),
  extractedText: text("extracted_text"),
  aiAnalysis: jsonb("ai_analysis"),
  isProcessing: boolean("is_processing").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Live AI Features
export const liveAiFeatures = pgTable("live_ai_features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  featureType: varchar("feature_type").notNull(), // exam_practice, timetable, lesson, university_finder, etc
  context: jsonb("context"),
  result: jsonb("result"),
  status: varchar("status").default('pending'), // pending, processing, completed
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// CBT Mode (Computer-Based Testing) - Exam Simulation
export const cbtExams = pgTable("cbt_exams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  examType: examTypeEnum("exam_type").notNull(), // jamb, waec, neco
  subjects: text("subjects").array().notNull(),
  totalQuestions: integer("total_questions").notNull(),
  totalDuration: integer("total_duration").notNull(), // in minutes
  questionsPerSubject: jsonb("questions_per_subject"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cbtQuestions = pgTable("cbt_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  examId: varchar("exam_id").notNull().references(() => cbtExams.id, { onDelete: 'cascade' }),
  subject: varchar("subject").notNull(),
  questionNumber: integer("question_number").notNull(),
  questionText: text("question_text").notNull(),
  options: jsonb("options").notNull(),
  correctAnswer: varchar("correct_answer").notNull(),
  explanation: text("explanation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cbtSessions = pgTable("cbt_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  examId: varchar("exam_id").notNull().references(() => cbtExams.id, { onDelete: 'cascade' }),
  status: varchar("status").default('in_progress').notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  timeSpent: integer("time_spent"),
  score: decimal("score", { precision: 5, scale: 2 }),
  totalCorrect: integer("total_correct"),
  totalAttempted: integer("total_attempted"),
  sessionData: jsonb("session_data"),
});

export const cbtAnswers = pgTable("cbt_answers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => cbtSessions.id, { onDelete: 'cascade' }),
  questionId: varchar("question_id").notNull().references(() => cbtQuestions.id, { onDelete: 'cascade' }),
  userAnswer: varchar("user_answer"),
  isCorrect: boolean("is_correct"),
  timeSpent: integer("time_spent"),
  flagged: boolean("flagged").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Live Session Recordings
export const recordings = pgTable("recordings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: varchar("session_id").references(() => liveSessions.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  audioData: text("audio_data").notNull(), // Base64 encoded audio
  transcript: jsonb("transcript").notNull(), // Array of transcript segments
  duration: integer("duration").notNull(), // in seconds
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRecordingSchema = createInsertSchema(recordings).omit({ id: true, createdAt: true });
export type InsertRecording = z.infer<typeof insertRecordingSchema>;
export type Recording = typeof recordings.$inferSelect;

// Generated Lessons from Recordings
export const generatedLessons = pgTable("generated_lessons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  recordingId: varchar("recording_id").references(() => recordings.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  objectives: text("objectives").array().notNull(),
  keyPoints: text("key_points").array().notNull(),
  summary: text("summary").notNull(),
  originalText: text("original_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertGeneratedLessonSchema = createInsertSchema(generatedLessons).omit({ id: true, createdAt: true });
export type InsertGeneratedLesson = z.infer<typeof insertGeneratedLessonSchema>;
export type GeneratedLesson = typeof generatedLessons.$inferSelect;

export const insertDocumentUploadSchema = createInsertSchema(documentUploads).omit({ id: true, createdAt: true });
export type InsertDocumentUpload = z.infer<typeof insertDocumentUploadSchema>;
export type DocumentUpload = typeof documentUploads.$inferSelect;

export const insertLiveAiFeatureSchema = createInsertSchema(liveAiFeatures).omit({ id: true, createdAt: true });
export type InsertLiveAiFeature = z.infer<typeof insertLiveAiFeatureSchema>;
export type LiveAiFeature = typeof liveAiFeatures.$inferSelect;

export const insertCbtExamSchema = createInsertSchema(cbtExams).omit({ id: true, createdAt: true });
export type InsertCbtExam = z.infer<typeof insertCbtExamSchema>;
export type CbtExam = typeof cbtExams.$inferSelect;

export const insertCbtQuestionSchema = createInsertSchema(cbtQuestions).omit({ id: true, createdAt: true });
export type InsertCbtQuestion = z.infer<typeof insertCbtQuestionSchema>;
export type CbtQuestion = typeof cbtQuestions.$inferSelect;

export const insertCbtSessionSchema = createInsertSchema(cbtSessions).omit({ id: true, startedAt: true, completedAt: true });
export type InsertCbtSession = z.infer<typeof insertCbtSessionSchema>;
export type CbtSession = typeof cbtSessions.$inferSelect;

export const insertCbtAnswerSchema = createInsertSchema(cbtAnswers).omit({ id: true, createdAt: true });
export type InsertCbtAnswer = z.infer<typeof insertCbtAnswerSchema>;
export type CbtAnswer = typeof cbtAnswers.$inferSelect;

// CBT Exam History - Track all exam attempts with analytics
export const cbtExamHistory = pgTable("cbt_exam_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: varchar("session_id").notNull().references(() => cbtSessions.id, { onDelete: 'cascade' }),
  examType: varchar("exam_type").notNull(),
  subjects: text("subjects").array().notNull(),
  score: decimal("score", { precision: 5, scale: 2 }).notNull(),
  totalQuestions: integer("total_questions").notNull(),
  correctAnswers: integer("correct_answers").notNull(),
  timeSpent: integer("time_spent").notNull(),
  summary: text("summary"),
  aiAnalysis: jsonb("ai_analysis"), // Gemini-powered insights
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// CBT Analytics - Per-topic performance tracking
export const cbtAnalytics = pgTable("cbt_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  subject: varchar("subject").notNull(),
  topic: varchar("topic").notNull(),
  attemptCount: integer("attempt_count").default(0),
  correctCount: integer("correct_count").default(0),
  averageScore: decimal("average_score", { precision: 5, scale: 2 }).default('0'),
  strengthLevel: varchar("strength_level").default('beginner'), // beginner, intermediate, advanced
  lastAttempt: timestamp("last_attempt"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// CBT Question Licensing - Track question sources and metadata
export const cbtQuestionLicensing = pgTable("cbt_question_licensing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").notNull().references(() => cbtQuestions.id, { onDelete: 'cascade' }),
  source: varchar("source").notNull(), // 'licensed', 'public', 'simulated'
  licenseId: varchar("license_id"),
  licenseProvider: varchar("license_provider"), // WAEC, JAMB, Cambridge, etc
  year: integer("year"),
  copyright: varchar("copyright"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCbtExamHistorySchema = createInsertSchema(cbtExamHistory).omit({ id: true, createdAt: true });
export type InsertCbtExamHistory = z.infer<typeof insertCbtExamHistorySchema>;
export type CbtExamHistory = typeof cbtExamHistory.$inferSelect;

export const insertCbtAnalyticsSchema = createInsertSchema(cbtAnalytics).omit({ id: true, updatedAt: true });
export type InsertCbtAnalytics = z.infer<typeof insertCbtAnalyticsSchema>;
export type CbtAnalytics = typeof cbtAnalytics.$inferSelect;

export const insertCbtQuestionLicensingSchema = createInsertSchema(cbtQuestionLicensing).omit({ id: true, createdAt: true });
export type InsertCbtQuestionLicensing = z.infer<typeof insertCbtQuestionLicensingSchema>;
export type CbtQuestionLicensing = typeof cbtQuestionLicensing.$inferSelect;

// Pricing Tiers
export const pricingTiers = pgTable("pricing_tiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  priceNaira: decimal("price_naira", { precision: 10, scale: 2 }).notNull(),
  billingPeriod: varchar("billing_period", { length: 50 }).default('monthly'),
  features: text("features").array().notNull(),
  maxChats: integer("max_chats").default(-1),
  maxGenerations: integer("max_generations").default(-1),
  maxProjects: integer("max_projects").default(-1),
  accessToAdvancedAI: boolean("access_to_advanced_ai").default(false),
  accessToCBT: boolean("access_to_cbt").default(false),
  accessToWebsiteGenerator: boolean("access_to_website_generator").default(false),
  accessToVoiceFeatures: boolean("access_to_voice_features").default(false),
  priority: integer("priority").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPricingTierSchema = createInsertSchema(pricingTiers).omit({ id: true, createdAt: true });
export type InsertPricingTier = z.infer<typeof insertPricingTierSchema>;
export type PricingTier = typeof pricingTiers.$inferSelect;

// Subscription Records
export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tierId: varchar("tier_id").notNull().references(() => pricingTiers.id),
  status: varchar("status", { length: 50 }).default('active'),
  paystackReference: varchar("paystack_reference", { length: 255 }),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  autoRenew: boolean("auto_renew").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;
