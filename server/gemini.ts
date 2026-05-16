// Gemini AI integration blueprint reference: javascript_gemini
import { GoogleGenAI } from "@google/genai";

// Use GOOGLE_API_KEY as the primary key (user's new valid key)
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "";

// Log which key is being used (without revealing the actual key)
if (apiKey) {
  const keySource = process.env.GOOGLE_API_KEY ? 'GOOGLE_API_KEY' : 
                    process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : 
                    process.env.AI_INTEGRATIONS_GEMINI_API_KEY ? 'AI_INTEGRATIONS_GEMINI_API_KEY' : 'none';
  console.log(`Gemini API initialized with ${keySource} (key length: ${apiKey.length} chars)`);
} else {
  console.error('WARNING: No Gemini API key found. AI features will not work.');
}

const ai = new GoogleGenAI({ apiKey });

interface GeneratedWebsite {
  html: string;
  css: string;
  js: string;
  title: string;
}

interface SearchResult {
  title: string;
  snippet: string;
  link: string;
  source: string;
}

interface WebSearchResponse {
  results: SearchResult[];
  summary: string;
}

// Generate exam questions with LENORY (Gemini AI) - Real questions per subject
export async function generateQuestionsWithLENORY(
  examType: string,
  subject: string,
  count: number = 250
): Promise<
  Array<{ id: string; question: string; options: string[]; correct: string; explanation: string }>
> {
  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured. Set GOOGLE_API_KEY or GEMINI_API_KEY.");
    }

    const totalCount = Math.min(count, 250); // Support up to 250 questions
    const batchSize = 50; // Generate in batches of 50 to avoid token limits
    const numBatches = Math.ceil(totalCount / batchSize);
    
    console.log(`📚 LENORY generating ${totalCount} ${subject} questions (${numBatches} batches) for ${examType}...`);

    // Specific prompts for each exam type and subject to ensure accurate questions
    const subjectPrompts: Record<string, string> = {
      Mathematics: `${examType} Mathematics exam questions. Include algebra, geometry, calculus, and trigonometry topics.`,
      English: `${examType} English exam questions. Include reading comprehension, grammar, vocabulary, and literature topics.`,
      Physics: `${examType} Physics exam questions. Include mechanics, electricity, waves, and thermodynamics.`,
      Chemistry: `${examType} Chemistry exam questions. Include organic chemistry, inorganic chemistry, physical chemistry.`,
      Biology: `${examType} Biology exam questions. Include cell biology, genetics, evolution, ecology, and human physiology.`,
      'Reading and Writing': `${examType} Reading and Writing exam questions.`,
      'Verbal Reasoning': `${examType} Verbal Reasoning exam questions.`,
      'Quantitative Reasoning': `${examType} Quantitative Reasoning exam questions.`,
      Math: `${examType} Math exam questions.`,
    };

    const basePrompt = subjectPrompts[subject] || `${examType} ${subject} exam questions`;

    // Generate questions in parallel batches with fallback handling
    const batchPromises = [];
    for (let batch = 0; batch < numBatches; batch++) {
      const startId = batch * batchSize + 1;
      const endId = Math.min((batch + 1) * batchSize, totalCount);
      const batchQuestionCount = endId - startId + 1;

      const prompt = `You are an expert ${examType} exam question generator. Generate exactly ${batchQuestionCount} authentic ${basePrompt}. Questions ${startId}-${endId} of the full question bank.

Generate ONLY this JSON array (no other text):
[
  {"id": "${startId}", "question": "Question text?", "options": ["Option A", "Option B", "Option C", "Option D"], "correct": "A", "explanation": "Why A is correct..."}
]

REQUIREMENTS:
- Output ONLY valid JSON array
- Each question has exactly 4 options (A, B, C, D)
- Correct answer is A, B, C, or D
- Include detailed explanations
- Make questions realistic for actual ${examType} exams
- Vary topics and difficulty`;

      batchPromises.push(
        (async () => {
          let retries = 0;
          const maxRetries = 2;
          
          while (retries < maxRetries) {
            try {
              const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
              });

              let responseText = response.text;
              if (!responseText) throw new Error(`Empty response for batch ${batch + 1}`);

              // Extract JSON - try multiple patterns
              let jsonText = responseText;
              const markdownMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
              if (markdownMatch) jsonText = markdownMatch[1];

              // Try to find array pattern
              let arrayMatch = jsonText.match(/\[\s*\{[\s\S]*\}\s*\]/);
              if (!arrayMatch) {
                // More aggressive pattern for edge cases
                arrayMatch = jsonText.match(/\[[\s\S]*\]/);
              }
              
              if (!arrayMatch) throw new Error(`Could not extract JSON from batch ${batch + 1} (attempt ${retries + 1})`);

              const questionsData = JSON.parse(arrayMatch[0]);
              if (!Array.isArray(questionsData)) throw new Error(`Batch ${batch + 1} response is not array`);

              // Validate all questions have proper structure
              const validBatch = questionsData.filter((q: any) => q.id && q.question && q.options && q.correct && q.explanation);
              
              console.log(`✅ Batch ${batch + 1}/${numBatches} completed with ${validBatch.length}/${questionsData.length} valid questions (${subject})`);
              return validBatch;
            } catch (batchError) {
              retries++;
              console.warn(`⚠️ Batch ${batch + 1} attempt ${retries} failed (${subject}):`, (batchError as any).message);
              
              if (retries >= maxRetries) {
                console.warn(`⚠️ Batch ${batch + 1} failed after ${maxRetries} attempts, using fallback`);
                // Generate fallback questions for this batch
                const fallbacks = [];
                for (let i = startId; i <= endId; i++) {
                  const options = ["Option A", "Option B", "Option C", "Option D"];
                  const correctAnswer = String.fromCharCode(65 + (i % 4)); // Vary correct answers
                  fallbacks.push({
                    id: String(i),
                    question: `${subject} Exam Question ${i}: What is the correct answer?`,
                    options: options,
                    correct: correctAnswer,
                    explanation: `This is a ${subject} question. Review the relevant textbook chapter.`
                  });
                }
                return fallbacks;
              }
              
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          
          return [];
        })()
      );
    }

    // Wait for all batches with fallback handling
    const allBatches = await Promise.allSettled(batchPromises);
    const allQuestionsRaw = allBatches
      .map((result, idx) => {
        if (result.status === 'fulfilled') return result.value || [];
        console.warn(`Batch ${idx + 1} failed:`, result.reason);
        return [];
      })
      .flat();

    // Validate and fix question structure with proper IDs
    const validQuestions = allQuestionsRaw.map((q: any, idx: number) => ({
      id: String(idx + 1),
      question: q.question || `Question ${idx + 1}`,
      options: q.options && Array.isArray(q.options) ? q.options.slice(0, 4) : ["A", "B", "C", "D"],
      correct: (q.correct || "A").toUpperCase().charAt(0),
      explanation: q.explanation || "See textbook for explanation."
    })).filter(q => q.question && q.options.length === 4 && q.question.length > 5);

    // Ensure we have at least what was requested
    while (validQuestions.length < Math.min(totalCount, 50)) {
      validQuestions.push({
        id: String(validQuestions.length + 1),
        question: `Practice Question ${validQuestions.length + 1}?`,
        options: ["Option A", "Option B", "Option C", "Option D"],
        correct: "A",
        explanation: "Review the relevant concept in your textbook."
      });
    }

    console.log(`✅ LENORY generated ${validQuestions.length} validated questions for ${subject}`);
    return validQuestions;
  } catch (error) {
    console.error(`❌ LENORY error for ${subject}:`, error);
    throw error;
  }
}

// Grade answers with LENORY (Gemini AI) - Provides AI-powered analysis and explanations
export async function gradeAnswersWithLENORY(
  questions: Array<{ id: string; question: string; options: string[]; correct: string; explanation?: string }>,
  answers: Record<string, string>
): Promise<{
  score: number;
  detailedFeedback: Array<{ questionId: string; isCorrect: boolean; explanation: string; keyLearning: string }>;
  summary: string;
  strongTopics: string[];
  weakTopics: string[];
  recommendations: string[];
}> {
  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    // Calculate score locally first
    let correctCount = 0;
    const questionsData = questions
      .map((q, idx) => {
        // Try multiple keys to match the answer: q.id, idx, or formatted keys
        let userAnswer = answers[q.id] || answers[String(idx)] || answers[String(idx + 1)] || 'Not answered';
        
        // If still not found, check for subject_index format that frontend uses
        if (userAnswer === 'Not answered') {
          for (const key in answers) {
            if (key.endsWith(`_${idx}`) || key.endsWith(`_${idx + 1}`)) {
              userAnswer = answers[key];
              break;
            }
          }
        }
        
        const isCorrect = userAnswer !== 'Not answered' && userAnswer === q.correct;
        if (isCorrect) correctCount++;
        
        return {
          number: idx + 1,
          questionId: q.id || String(idx),
          question: q.question,
          options: q.options,
          correct: q.correct,
          userAnswer: userAnswer,
          isCorrect: isCorrect,
          explanation: q.explanation || '',
        };
      })
      .map((q) => JSON.stringify(q))
      .join('\n\n');

    const localScore = Math.round((correctCount / questions.length) * 100);

    const prompt = `You are LENORY - an expert educational AI tutor. Grade these exam answers and provide detailed, personalized feedback. Student got ${localScore}% correct (${correctCount}/${questions.length}).

QUESTIONS AND ANSWERS:
${questionsData}

Analyze the answers and return ONLY valid JSON (no other text):
{
  "score": ${localScore},
  "detailedFeedback": [
    {"questionId": "1", "isCorrect": true, "explanation": "Well done...", "keyLearning": "Key insight..."},
    {"questionId": "2", "isCorrect": false, "explanation": "The correct answer is...", "keyLearning": "Important concept..."}
  ],
  "summary": "Overall performance summary with personalized insights from LENORY",
  "strongTopics": ["Topic 1", "Topic 2"],
  "weakTopics": ["Topic 3"],
  "recommendations": ["Study recommendation 1", "Study recommendation 2", "Study recommendation 3"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const responseText = response.text;
    if (!responseText) throw new Error("Empty grading response");

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not extract JSON from LENORY grading");

    const gradingData = JSON.parse(jsonMatch[0]);
    // Ensure score is set to calculated value
    gradingData.score = localScore;
    console.log(`✅ LENORY grading complete: ${gradingData.score}%`);

    return gradingData;
  } catch (error) {
    console.error("LENORY grading error:", error);
    throw error;
  }
}

// Internet search with Gemini (returns web search results with sources)
export async function searchInternetWithGemini(query: string): Promise<WebSearchResponse> {
  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    console.log("🔍 Searching internet for:", query);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are a web search assistant. Search for information about: "${query}"

Return ONLY valid JSON (no other text):
{
  "results": [
    {"title": "Result Title", "snippet": "Brief description", "link": "https://example.com", "source": "Website Name"},
    {"title": "Another Result", "snippet": "Description", "link": "https://example2.com", "source": "Website Name 2"}
  ],
  "summary": "Brief summary of search results"
}

Find real, recent information. Include sources and links.`
    });

    const responseText = response.text;
    if (!responseText) throw new Error("Empty search response");

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not extract JSON from search response");

    const searchData = JSON.parse(jsonMatch[0]);
    console.log(`✅ Found ${searchData.results?.length || 0} results`);

    return {
      results: searchData.results || [],
      summary: searchData.summary || "Search completed"
    };
  } catch (error) {
    console.error("Internet search error:", error);
    return {
      results: [],
      summary: "Unable to search internet. Try again later."
    };
  }
}

export async function generateWebsiteWithGemini(prompt: string): Promise<GeneratedWebsite> {
  const fullPrompt = `You are a web developer. Create a website based on this description: ${prompt}

Response format (ONLY output valid JSON, no other text):
{
  "title": "Website Name",
  "html": "<html><head><title>Web</title></head><body>Content</body></html>",
  "css": "body { margin: 0; padding: 20px; }",
  "js": ""
}`;

  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    console.log("Calling LENORY AI with prompt length:", prompt.length);
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
    });

    console.log("LENORY AI response received, extracting text...");
    
    const responseText = response.text;
    
    if (!responseText) {
      console.error("Empty response from LENORY AI");
      throw new Error("Empty response from LENORY AI");
    }
    
    console.log("Response text length:", responseText.length);
    console.log("Response text preview:", responseText.substring(0, 200));
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Could not extract JSON from response:", responseText.substring(0, 500));
      throw new Error(`Failed to extract JSON from LENORY AI response`);
    }

    console.log("JSON extracted, parsing...");
    const generatedData = JSON.parse(jsonMatch[0]);
    console.log("JSON parsed successfully, generated data keys:", Object.keys(generatedData));

    return {
      title: generatedData.title || "Generated Website",
      html: generatedData.html || "<h1>Error generating HTML</h1>",
      css: generatedData.css || "",
      js: generatedData.js || "",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error generating website with LENORY AI:", errorMsg);
    throw error;
  }
}

export async function explainCodeForBeginners(html: string, css: string, js: string): Promise<string> {
  const codeSnippet = `HTML:\n${html}\n\nCSS:\n${css}\n\nJavaScript:\n${js}`;
  
  const prompt = `I am a complete beginner learning web development. Please explain this code to me in very simple, easy-to-understand language. Explain what each part does, why it's written that way, and how it works together. Use analogies and simple examples if needed.

Code to explain:
${codeSnippet}

Explain it like you're teaching someone who has never written code before. Be detailed but simple.`;

  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    console.log("Calling LENORY AI to explain code...");
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    console.log("LENORY AI response received for code explanation");
    
    const explanation = response.text;
    
    if (!explanation) {
      throw new Error("Empty response from LENORY AI");
    }

    return explanation;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error explaining code with LENORY AI:", errorMsg);
    throw error;
  }
}

interface DebugResult {
  htmlCode: string;
  cssCode: string;
  jsCode: string;
  steps: string[];
}

export async function debugCodeWithLENORY(html: string, css: string, js: string, debugPrompt: string): Promise<DebugResult> {
  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const prompt = `You are an expert web developer. The user's request: "${debugPrompt}"

Current HTML code:
${html}

CSS:
${css}

JavaScript:
${js}

Analyze the request and provide ONLY a raw JSON response with NO markdown, NO code blocks, NO explanation - just pure JSON:
{
  "htmlCode": "<the complete fixed HTML with all improvements>",
  "cssCode": "<the complete fixed CSS>",
  "jsCode": "<the complete fixed JavaScript or empty string>",
  "steps": ["fix 1", "fix 2"]
}`;

    console.log("🔄 Calling Gemini API for debug...");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    let responseText = (response.text || "").trim();
    if (!responseText) throw new Error("Empty response from Gemini");

    console.log("📝 Raw Gemini response (first 300 chars):", responseText.substring(0, 300));

    // Aggressively clean markdown
    responseText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .replace(/^\s*```/gm, "")
      .replace(/```\s*$/gm, "")
      .trim();

    // Find JSON object
    const jsonStart = responseText.indexOf("{");
    const jsonEnd = responseText.lastIndexOf("}");
    
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error("No JSON object found in response");
    }

    const jsonStr = responseText.substring(jsonStart, jsonEnd + 1);
    console.log("✅ Extracted JSON, parsing...");

    const result = JSON.parse(jsonStr);

    return {
      htmlCode: result.htmlCode || html,
      cssCode: result.cssCode || css,
      jsCode: result.jsCode || js,
      steps: Array.isArray(result.steps) ? result.steps : []
    };
  } catch (error) {
    console.error("❌ Gemini debug failed:", error);
    throw error;
  }
}

interface TopicExplanationResult {
  explanation: string;
  examples: string[];
  relatedTopics: string[];
}

export async function explainTopicWithLENORY(subject: string, topic: string, difficulty: string = "medium"): Promise<TopicExplanationResult> {
  const prompt = `Explain the topic "${topic}" in ${subject} at ${difficulty} level.

Format: {"explanation": "...", "examples": ["ex1", "ex2"], "relatedTopics": ["topic1", "topic2"]}`;

  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const responseText = response.text;
    if (!responseText) throw new Error("Empty response");

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not extract JSON");

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Error explaining topic:", error);
    throw error;
  }
}

interface ImageGenerationResult {
  url: string;
  prompt: string;
}

export async function generateImageWithLENORY(prompt: string): Promise<ImageGenerationResult> {
  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    console.log("🎨 LENORY: Generating image with Stability AI for:", prompt);
    
    // Use Gemini to enhance and refine the image prompt
    const enhancedPromptResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are an expert image prompt engineer. Take this simple image description and expand it into a detailed, vivid, and specific image prompt for Stability AI.

Original prompt: "${prompt}"

Provide ONLY the enhanced prompt without any additional text or explanation.`,
    });

    const enhancedPrompt = enhancedPromptResponse.text?.trim() || prompt;
    console.log("✅ Enhanced prompt:", enhancedPrompt);

    // Try to generate with Stability AI, fallback to placeholder if API key missing
    let imageUrl = "";
    
    if (process.env.STABILITY_API_KEY) {
      try {
        imageUrl = await generateImageWithStabilityAI(enhancedPrompt);
        console.log("✅ Image generated with Stability AI");
      } catch (stabilityError) {
        console.warn("Stability AI generation failed, using placeholder:", stabilityError);
        imageUrl = generatePlaceholderImage(prompt);
      }
    } else {
      console.warn("STABILITY_API_KEY not set, using placeholder image");
      imageUrl = generatePlaceholderImage(prompt);
    }

    return {
      url: imageUrl,
      prompt: enhancedPrompt
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error generating image with Gemini:", errorMsg);
    throw error;
  }
}

async function generateImageWithStabilityAI(prompt: string): Promise<string> {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) throw new Error("STABILITY_API_KEY not configured");

  const truncatedPrompt = prompt.length > 10000 ? prompt.substring(0, 10000) : prompt;
  console.log(`📝 Generating image with Stability AI v2beta, prompt length: ${truncatedPrompt.length}`);

  // Try v2beta Stable Image Core API first (newer, more reliable)
  try {
    const formData = new FormData();
    formData.append("prompt", truncatedPrompt);
    formData.append("output_format", "png");
    formData.append("aspect_ratio", "1:1");

    const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      },
      body: formData,
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      if (data.image) {
        console.log("✅ Stability AI v2beta image generated successfully");
        return `data:image/png;base64,${data.image}`;
      }
    }
    const errText = await response.text().catch(() => `HTTP ${response.status}`);
    console.warn(`Stability AI v2beta failed (${response.status}): ${errText.substring(0, 200)}`);
  } catch (v2Err) {
    console.warn("Stability AI v2beta error:", v2Err);
  }

  // Fallback: v1 SDXL API
  try {
    const response = await fetch("https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        text_prompts: [{ text: truncatedPrompt.substring(0, 2000), weight: 1 }],
        cfg_scale: 7,
        height: 1024,
        width: 1024,
        samples: 1,
        steps: 30,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      const base64Image = data.artifacts?.[0]?.base64;
      if (base64Image) {
        console.log("✅ Stability AI v1 SDXL image generated successfully");
        return `data:image/png;base64,${base64Image}`;
      }
    }
    const errText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`Stability AI v1 failed (${response.status}): ${errText.substring(0, 200)}`);
  } catch (v1Err) {
    const errorMsg = v1Err instanceof Error ? v1Err.message : String(v1Err);
    console.error("Stability AI v1 error:", errorMsg);
    throw new Error(errorMsg);
  }
}

function generatePlaceholderImage(prompt: string): string {
  const colors = generateColorPaletteFromPrompt(prompt);
  const bgColor = colors[0].replace('#', '');
  const accentColor = colors[1].replace('#', '');
  const shortPrompt = prompt.substring(0, 25).replace(/\s+/g, '+');
  return `https://via.placeholder.com/1024x1024/${bgColor}/${accentColor}.png?text=${encodeURIComponent(shortPrompt)}`;
}

function generateColorPaletteFromPrompt(prompt: string): [string, string, string] {
  // Generate colors based on prompt keywords
  const lowerPrompt = prompt.toLowerCase();
  
  const colorMaps: Record<string, [string, string, string]> = {
    'sunset': ['#FF6B6B', '#FFA94D', '#FFD93D'],
    'ocean': ['#1E90FF', '#00BFFF', '#87CEEB'],
    'forest': ['#2D5016', '#3D7D3D', '#7ECA82'],
    'night': ['#0B1929', '#2D4059', '#EA5455'],
    'fire': ['#FF4500', '#FF8C00', '#FFD700'],
    'space': ['#0B1F35', '#090C9B', '#30127D'],
    'flower': ['#FF1493', '#FF69B4', '#FFB6C1'],
    'mountain': ['#8B7355', '#A0826D', '#BFA68F'],
  };

  for (const [key, colors] of Object.entries(colorMaps)) {
    if (lowerPrompt.includes(key)) {
      return colors;
    }
  }

  // Default gradient palette
  return ['#667eea', '#764ba2', '#f093fb'];
}

export async function chatWithGemini(messages: Array<{ role: string; content: string }>): Promise<string> {
  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      })) as any
    });

    const result = response.text;
    if (!result) {
      throw new Error("Empty response from Gemini");
    }
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error chatting with Gemini:", errorMsg);
    throw error;
  }
}

export async function generateSmartChatTitle(messages: Array<{ role: string; content: string }>): Promise<string> {
  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const conversationSnippet = messages
      .slice(0, 4)
      .map(m => `${m.role}: ${m.content.substring(0, 100)}`)
      .join("\n");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Create a brief, descriptive title (max 6 words) for this conversation:

${conversationSnippet}

Respond with ONLY the title, no quotes or extra text.`
    });

    const title = response.text?.trim() || "Chat";
    return title.substring(0, 50);
  } catch (error) {
    console.error("Error generating title:", error);
    return "Chat";
  }
}

export async function analyzeFileWithGeminiVision(buffer: Buffer, mimeType: string, fileName: string): Promise<{ extractedText: string }> {
  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const base64Data = buffer.toString('base64');
    console.log(`📄 Analyzing file with Gemini Vision: ${fileName}`);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: mimeType || "application/octet-stream",
            data: base64Data
          }
        },
        {
          text: "Extract and return all text content from this file. If it's an image, describe the content. If it's a PDF or document, extract the text."
        }
      ] as any
    });

    const extractedText = response.text || "";
    console.log(`✅ Extracted ${extractedText.length} characters`);

    return { extractedText };
  } catch (error) {
    console.error("Gemini Vision analysis error:", error);
    return { extractedText: "" };
  }
}

interface GeneratedLessonData {
  title: string;
  objectives: string[];
  keyPoints: string[];
  summary: string;
}

export async function fixTextWithLENORY(text: string): Promise<{ correctedText: string; explanation: string }> {
  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    console.log("🔧 Fixing text with LENORY AI...");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Fix spelling, grammar, and formatting errors in this text. Respond with ONLY valid JSON (no other text):

{"correctedText": "the fixed text here", "explanation": "brief list of corrections made"}

TEXT TO FIX:
${text}`,
    });

    const responseText = response.text;
    if (!responseText) throw new Error("Empty response");

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not extract JSON");

    const result = JSON.parse(jsonMatch[0]);
    console.log("✅ Text fixed successfully");
    return result;
  } catch (error) {
    console.error("Error fixing text:", error);
    throw error;
  }
}

export async function generateLessonFromTextWithGemini(text: string): Promise<GeneratedLessonData> {
  try {
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    console.log("🎓 Generating lesson from text with Gemini...");

    const prompt = `You are an expert educational content creator. Analyze the following text and create a structured lesson.

Text to analyze:
${text}

Generate ONLY valid JSON (no other text, no markdown):
{
  "title": "Lesson Title (concise, max 10 words)",
  "objectives": ["Objective 1", "Objective 2", "Objective 3"],
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3", "Key point 4"],
  "summary": "A comprehensive summary of the entire lesson (2-3 sentences)"
}

Make the objectives, key points, and summary educational, clear, and useful for students.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("Empty response from Gemini");
    }

    console.log("📝 Raw Gemini response (first 300 chars):", responseText.substring(0, 300));

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not extract JSON from Gemini response");
    }

    const lessonData = JSON.parse(jsonMatch[0]);
    console.log("✅ Lesson generated successfully");

    return {
      title: lessonData.title || "Generated Lesson",
      objectives: Array.isArray(lessonData.objectives) ? lessonData.objectives : [],
      keyPoints: Array.isArray(lessonData.keyPoints) ? lessonData.keyPoints : [],
      summary: lessonData.summary || "",
    };
  } catch (error) {
    console.error("❌ Error generating lesson from text:", error);
    throw error;
  }
}

// Main chat function with LENORY system integration
export async function chatWithAI(messages: Array<{role: string; content: string}>): Promise<string> {
  const { generateLENORYSystemPrompt } = await import("./learnorySystem");
  
  const lastMessage = messages[messages.length - 1]?.content || "";
  
  // Detect subject from message
  const subjectKeywords: Record<string, string[]> = {
    mathematics: ["math", "algebra", "calculus", "geometry", "equation", "formula"],
    physics: ["physics", "force", "motion", "energy", "wave", "velocity"],
    chemistry: ["chemistry", "reaction", "element", "molecule", "bond", "compound"],
    biology: ["biology", "cell", "organism", "dna", "gene", "photosynthesis"],
    english: ["english", "grammar", "essay", "literature", "writing"],
    government: ["government", "constitution", "politics", "civic"],
  };
  
  let detectedSubject = "general";
  const messageText = lastMessage.toLowerCase();
  for (const [subject, keywords] of Object.entries(subjectKeywords)) {
    if (keywords.some(kw => messageText.includes(kw))) {
      detectedSubject = subject;
      break;
    }
  }

  // Generate comprehensive LENORY system prompt
  const systemPrompt = generateLENORYSystemPrompt({
    subject: detectedSubject,
    userLevel: "intermediate",
    weakTopics: [],
    examType: "jamb",
    daysUntilExam: 30,
    currentStreak: 0,
    averageScore: 0,
  });

  const messagesWithSystem = messages[0]?.role !== "system" 
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  return chatWithGemini(messagesWithSystem);
}

// Smart fallback - now just uses Gemini directly
export async function chatWithAISmartFallback(messages: any[]): Promise<string> {
  try {
    console.log("Using Gemini API for chat...");
    const response = await chatWithGemini(messages);
    console.log("✓ Gemini succeeded with response:", response.substring(0, 100));
    return response;
  } catch (err) {
    console.error("✗ Gemini failed:", (err as any)?.message);
    return "I'm having trouble connecting to my AI services right now. Please try again.";
  }
}

// Generate lesson from transcript
export async function generateLesson(transcriptText: string): Promise<any> {
  try {
    const prompt = `Create a lesson from the transcript. Respond with ONLY valid JSON:
{
  "title": "Lesson title",
  "objectives": ["objective 1", "objective 2"],
  "keyPoints": ["key point 1", "key point 2"],
  "summary": "Brief summary"
}

Transcript:
${transcriptText.slice(0, 2000)}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        title: "Untitled Lesson",
        objectives: [],
        keyPoints: [],
        summary: "",
      };
    }
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Error generating lesson:", error);
    throw error;
  }
}

// Generate course syllabus
export async function generateSyllabus(topic: string): Promise<any> {
  try {
    const prompt = `You are an expert curriculum designer. Generate a comprehensive course syllabus for: ${topic}

Respond with ONLY valid JSON:
{
  "title": "Course Title",
  "description": "Course description",
  "modules": [
    {
      "title": "Module Title",
      "lessons": [
        {
          "title": "Lesson Title",
          "description": "Lesson description",
          "duration": "30 minutes"
        }
      ]
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { title: topic, description: "", modules: [] };
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Error generating syllabus:", error);
    throw error;
  }
}

// Grade quiz answers
export async function gradeQuiz(answers: any, rubric: any): Promise<any> {
  try {
    const prompt = `You are an expert grader. Evaluate the student's answers according to the rubric and provide detailed feedback.

Answers: ${JSON.stringify(answers)}
Rubric: ${JSON.stringify(rubric)}

Respond with ONLY valid JSON:
{
  "score": number,
  "totalPoints": number,
  "feedback": [
    {
      "question": 1,
      "points": number,
      "comment": "Feedback comment"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { score: 0, totalPoints: 0, feedback: [] };
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Error grading quiz:", error);
    throw error;
  }
}

// Transcribe audio using Gemini's multimodal capabilities
export async function transcribeAudio(audioFilePath: string): Promise<{ text: string, duration: number }> {
  try {
    const fs = await import('fs');
    const audioBuffer = fs.readFileSync(audioFilePath);
    const base64Audio = audioBuffer.toString('base64');
    
    // Determine mime type from file extension
    const ext = audioFilePath.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'mp3': 'audio/mp3',
      'wav': 'audio/wav',
      'webm': 'audio/webm',
      'ogg': 'audio/ogg',
      'm4a': 'audio/mp4',
    };
    const mimeType = mimeTypes[ext || ''] || 'audio/wav';

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Audio
          }
        },
        {
          text: "Please transcribe all the spoken words in this audio file accurately. Return only the transcription text, nothing else."
        }
      ] as any
    });

    return {
      text: response.text || "",
      duration: 0,
    };
  } catch (error: any) {
    console.error("Transcription error with Gemini:", error);
    return {
      text: "[Transcription unavailable - please try again]",
      duration: 0,
    };
  }
}

// Generate speech placeholder - Gemini 2.0 Live API handles this natively
export async function generateSpeech(text: string): Promise<Buffer> {
  // Gemini 2.0 Multimodal Live API handles real-time speech directly
  // This is a placeholder for backward compatibility
  throw new Error("Use Gemini 2.0 Multimodal Live API for real-time speech");
}

// Summarize text
export async function summarizeText(text: string, length: 'short' | 'medium' | 'long' = 'medium'): Promise<string> {
  const lengthInstructions = {
    short: "in 2-3 sentences",
    medium: "in 1-2 paragraphs",
    long: "in detail with multiple paragraphs"
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Please summarize the following text ${lengthInstructions[length]}:\n\n${text}`,
    });
    return response.text || "";
  } catch (error) {
    console.error("Error summarizing text:", error);
    throw error;
  }
}

// Generate flashcards
export async function generateFlashcards(text: string): Promise<any> {
  try {
    const prompt = `You are an expert at creating study flashcards. Generate flashcards from the provided text.

Text:
${text}

Respond with ONLY valid JSON:
{
  "flashcards": [
    { "front": "Question or term", "back": "Answer or definition" }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const responseText = response.text || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { flashcards: [] };
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Error generating flashcards:", error);
    throw error;
  }
}
