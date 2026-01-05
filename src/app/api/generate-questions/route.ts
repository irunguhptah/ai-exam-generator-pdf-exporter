import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { auth } from "@/lib/auth";
import { removeDuplicates, DuplicationContext } from "@/lib/duplicate-detector";

// Model strength classification
const getModelStrength = (model: string): 'weak' | 'medium' | 'strong' => {
  const strongModels = [
    'openai/gpt-oss-120b',
    'llama-3.3-70b-versatile',
    'meta-llama/llama-4-maverick-17b-128e-instruct'
  ];
  
  const mediumModels = [
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant'
  ];
  
  if (strongModels.some(m => model.includes(m))) return 'strong';
  if (mediumModels.some(m => model.includes(m))) return 'medium';
  return 'weak';
};

// Get max_tokens limit for specific model
const getMaxTokensForModel = (model: string): number => {
  // Model-specific limits based on their actual constraints
  if (model.includes('meta-llama/llama-4-maverick-17b-128e-instruct')) return 8192;
  if (model.includes('llama-3.3-70b-versatile')) return 8192;
  if (model.includes('llama-3.1-8b-instant')) return 8192;
  if (model.includes('openai/gpt-oss-120b')) return 8192;
  if (model.includes('openai/gpt-oss-20b')) return 8192;
  
  // Default safe limit
  return 8192;
};

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Attempt a completion with model fallbacks when model is not found or inaccessible.
async function attemptGroqCompletion(messages: any[], preferredModel: string, options: { temperature?: number; max_tokens?: number }) {
  const envFallbacks = process.env.GROQ_FALLBACK_MODELS
    ? process.env.GROQ_FALLBACK_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // Default fallback list if none provided via env  
  const defaultFallbacks = ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  const fallbacks = Array.from(new Set([...(preferredModel ? [preferredModel] : []), ...envFallbacks, ...defaultFallbacks]));
  
  // Add network connectivity check
  const isNetworkAvailable = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      await fetch('https://api.groq.com/openai/v1/models', { 
        signal: controller.signal, 
        method: 'HEAD' 
      });
      clearTimeout(timeoutId);
      return true;
    } catch {
      return false;
    }
  };

  // Check network connectivity first
  if (!(await isNetworkAvailable())) {
    console.error("🚨 No network connectivity to Groq API");
    
    // In development, return mock completion for testing
    if (process.env.NODE_ENV === 'development') {
      console.log("🔄 Development mode: returning mock completion due to network issues");
      return {
        choices: [{
          message: {
            content: JSON.stringify([
              {
                questionText: "What is the primary function of the cardiovascular system?",
                questionType: "multiple_choice",
                optionA: "Transport oxygen and nutrients",
                optionB: "Filter toxins from blood", 
                optionC: "Produce hormones",
                optionD: "Regulate body temperature",
                correctAnswer: "Transport oxygen and nutrients",
                rationale: "The cardiovascular system's primary function is to transport oxygen, nutrients, and waste products throughout the body."
              }
            ])
          }
        }]
      };
    }
    
    throw new Error("Network connectivity issues - unable to reach Groq API");
  }

  let lastError: any = null;
  for (const m of fallbacks) {
    try {
      console.log(`Attempting Groq completion with model: ${m}`);
      const modelMaxTokens = getMaxTokensForModel(m);
      const requestedTokens = options.max_tokens ?? modelMaxTokens;
      const actualTokens = Math.min(requestedTokens, modelMaxTokens);
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      // Increase timeout for large generations to 3 minutes
      const timeoutMs = process.env.GROQ_TIMEOUT_MS ? Number(process.env.GROQ_TIMEOUT_MS) : 180000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const completion = await groq.chat.completions.create({
        messages,
        model: m,
        temperature: options.temperature ?? 0.7,
        max_tokens: actualTokens,
      });
      
      clearTimeout(timeoutId);
      // Attach used model for callers that want to log it
      (completion as any).__usedModel = m;
      return completion;
    } catch (err: any) {
      lastError = err;
      // Inspect for model-not-found / invalid model errors
      const errMsg = err?.message || JSON.stringify(err?.response?.data || err || '');
      console.warn(`Groq model attempt failed for '${m}': ${errMsg.substring ? errMsg.substring(0, 200) : errMsg}`);

      const isModelNotFound = errMsg && (errMsg.includes('model_not_found') || errMsg.includes('does not exist') || (err?.status === 404));
      // If upstream returned a gateway timeout, surface a specific error so callers can return partial results
      const isUpstream504 = (err?.status === 504) || (err?.response && err.response.status === 504) || errMsg.includes('504') || errMsg.includes('Gateway Timeout');
      if (isUpstream504) {
        const e = new Error('Upstream model gateway timeout (504)');
        (e as any).isUpstream504 = true;
        throw e;
      }

      if (!isModelNotFound) {
        // For other errors, rethrow immediately to avoid hiding problems
        throw err;
      }

      // If model not found, continue to next fallback
      console.log(`Model '${m}' not available, trying next fallback if any...`);
    }
  }

  // If we exhausted fallbacks, throw the last error (prefer the original message)
  throw lastError || new Error('All Groq model attempts failed');
}


export async function POST(request: NextRequest) {
  let partialQuestions: any[] = [];

  try {
    // Check authentication - use request.headers to support Bearer tokens
    // Add network connectivity check and dev mode bypass
    let session;
    try {
      session = await auth.api.getSession({ headers: request.headers });
    } catch (authError: any) {
      console.warn("🚨 Authentication failed (likely network issue):", authError.message);
      
      // In development, allow bypass if network issues
      if (process.env.NODE_ENV === 'development' && authError.message?.includes('ENOTFOUND')) {
        console.log("🔓 Development mode: bypassing auth due to network connectivity issues");
        session = { user: { id: 'dev-user' } }; // Mock session for development
      } else {
        return NextResponse.json({ 
          error: "Authentication service unavailable", 
          details: authError.message?.includes('ENOTFOUND') ? "Database connection failed" : "Authentication error"
        }, { status: 503 });
      }
    }
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { subject, difficulty, questionLength, numQuestions, context, coreTestingAreas, questionTypes, model, stream, scenarioFormat, domainDistribution } =
      body;

    // Check if streaming is requested
    if (stream) {
      return handleStreamingGeneration(request, body);
    }

    // Validate input
    if (!subject || !difficulty || !numQuestions) {
      return NextResponse.json(
        { error: "Missing required fields: subject, difficulty, numQuestions" },
        { status: 400 }
      );
    }

    // Use provided model or default to working model
    const selectedModel = model || "openai/gpt-oss-20b";

    // Build the prompt
    const questionTypesStr = questionTypes?.length
      ? questionTypes.join(", ")
      : "multiple_choice";
    
    // Validation logging
    console.log(`📊 API Request - Requested: ${numQuestions} questions of types: [${questionTypesStr}]`);

    // Determine scenario format requirements
    const scenarioFormatGuide = {
      'scenario': {
        description: "Scenario-based questions using realistic situations or cases that require application of knowledge to determine the answer",
        approach: "Create realistic scenarios with specific details (age, presentation, context) followed by clear, direct questions about the scenario",
        examples: "A 54-year-old woman presents with acute right-sided weakness and slurred speech. Her CT scan shows no hemorrhage. What is the most appropriate next step in management?"
      },
      'normal': {
        description: "Direct knowledge questions that focus on facts, definitions, or core concepts that can be answered directly",
        approach: "Focus on straightforward questions testing specific knowledge without complex scenarios",
        examples: "Which Florida statute governs the licensing and regulation of bail bond agents?"
      },
      'mixed': {
        description: "Realistic exam progression: foundation knowledge building to complex application",
        approach: "Start with 40% direct knowledge questions (foundational concepts), then intermix with 60% scenario-based questions (application and analysis) for authentic exam experience",
        examples: "Begin with definitions and concepts, progress to case studies and clinical scenarios, creating natural difficulty progression"
      },
      'source-based': {
        description: "Match the format and style found in the provided source materials or additional context",
        approach: "Analyze the source materials and additional context to determine the question format, style, and complexity level, then replicate that format exactly",
        examples: "If source shows scenario-based questions, create scenarios. If source shows direct questions, create direct questions. Mirror the style, tone, and format of the provided examples."
      }
    };

    const currentScenarioFormat = scenarioFormat || 'mixed';
    const scenarioGuide = scenarioFormatGuide[currentScenarioFormat as keyof typeof scenarioFormatGuide] || scenarioFormatGuide.mixed;

    // Determine question length requirements
    const questionLengthGuide = {
      'very-short': {
        description: "Ultra-concise questions with minimal explanations",
        questionStyle: "Keep question stems under 30 words. Direct, no-fluff questions.",
        rationaleStyle: "Rationales should be 5-10 words maximum.",
        scenarioComplexity: "Minimal context, focus on core concepts only."
      },
      short: {
        description: "Concise, direct questions with brief explanations",
        questionStyle: "Keep question stems under 50 words. Use straightforward scenarios without excessive detail.",
        rationaleStyle: "Rationales should be 1 concise sentence (10-15 words maximum).",
        scenarioComplexity: "Simple, focused scenarios with minimal background information."
      },
      'short-medium': {
        description: "Moderately concise questions with some context",
        questionStyle: "Question stems should be 50-75 words. Include some context but stay focused.",
        rationaleStyle: "Rationales should be 1 sentence (15-20 words maximum).",
        scenarioComplexity: "Simple scenarios with essential background information."
      },
      medium: {
        description: "Balanced questions with moderate detail and explanations", 
        questionStyle: "Question stems should be 75-100 words. Include necessary context but avoid excessive detail.",
        rationaleStyle: "Rationales should be 1-2 clear sentences (20-30 words maximum).",
        scenarioComplexity: "Moderately detailed scenarios with relevant background and context."
      },
      'medium-long': {
        description: "Detailed questions with rich context",
        questionStyle: "Question stems should be 100-150 words. Include rich context and detailed scenarios.",
        rationaleStyle: "Rationales should be 2 sentences (25-35 words maximum).",
        scenarioComplexity: "Detailed scenarios with comprehensive background and multiple variables."
      },
      long: {
        description: "Comprehensive, detailed questions with thorough explanations",
        questionStyle: "Question stems should be 150-200 words. Include rich context, detailed scenarios, and comprehensive background.",
        rationaleStyle: "Rationales should be detailed explanations (30-50 words) with evidence-based reasoning.",
        scenarioComplexity: "Complex, multi-layered scenarios with extensive background, multiple variables, and realistic detail."
      },
      'very-long': {
        description: "Highly comprehensive case-study style questions",
        questionStyle: "Question stems can be 200+ words. Include extensive case studies, multiple data points, and complex scenarios.",
        rationaleStyle: "Rationales should be comprehensive explanations (40-60 words) with detailed reasoning.",
        scenarioComplexity: "Complex case studies with extensive background, multiple variables, data analysis, and realistic professional scenarios."
      },
      hybrid: {
        description: "Mixed question lengths for variety and comprehensive assessment",
        questionStyle: "Vary question lengths: 25% very-short/short (20-50 words), 50% medium/medium-long (75-150 words), 25% long/very-long (150+ words).",
        rationaleStyle: "Vary rationale lengths to match question complexity: brief for short questions, detailed for long questions.",
        scenarioComplexity: "Mix of simple direct questions, moderate scenarios, and complex case studies for comprehensive assessment."
      }
    };

    const currentLengthGuide = questionLengthGuide[questionLength as keyof typeof questionLengthGuide] || questionLengthGuide.medium;

    // Determine if this is a healthcare-related subject
    const isHealthcareSubject =
      subject.toLowerCase().includes("nursing") ||
      subject.toLowerCase().includes("medical") ||
      subject.toLowerCase().includes("healthcare") ||
      subject.toLowerCase().includes("medicine") ||
      subject.toLowerCase().includes("anatomy") ||
      subject.toLowerCase().includes("physiology");

    // Process core testing areas with intelligent extraction
    const processedCoreAreas = coreTestingAreas ? (() => {
      const input = coreTestingAreas.trim();
      
      // If it's already a bullet list, use existing logic
      if (input.includes('\n') && (input.includes('•') || input.includes('-') || input.includes('*'))) {
        return input
          .split('\n')
          .map((area: string) => area.trim())
          .filter((area: string) => area && area.length > 0)
          .map((area: string) => {
            // Remove existing bullet points or dashes
            const cleaned = area.replace(/^[•\-\*]\s*/, '').trim();
            // Extract key points (split by commas, semicolons, or "and")
            const keyPoints = cleaned
              .split(/[,;]|\s+and\s+/i)
              .map(point => point.trim())
              .filter(point => point.length > 0)
              .slice(0, 3); // Limit to 3 key points per area
            return keyPoints.length > 1 ? keyPoints.join(', ') : cleaned;
          })
          .slice(0, 8); // Limit to 8 main areas
      }
      
      // Otherwise, use intelligent paragraph extraction
      const extracted = [];
      
      // Extract content within parentheses
      const parenthesesRegex = /\(([^)]+)\)/g;
      let match;
      while ((match = parenthesesRegex.exec(input)) !== null) {
        const content = match[1].trim();
        if (content.includes(',')) {
          // Split by comma and clean up
          const items = content.split(',').map(item => item.trim());
          extracted.push(...items);
        } else {
          extracted.push(content);
        }
      }
      
      // Extract items after "including" (case insensitive)
      const includingRegex = /including\s+([^.]+)/gi;
      while ((match = includingRegex.exec(input)) !== null) {
        const content = match[1].trim();
        
        // Remove parenthetical content since we already extracted it
        const cleanContent = content.replace(/\([^)]*\)/g, '').trim();
        
        if (cleanContent.includes(',')) {
          const items = cleanContent.split(',').map(item => item.trim()).filter(item => item);
          extracted.push(...items);
        } else if (cleanContent) {
          extracted.push(cleanContent);
        }
      }
      
      // Extract key assessment terms
      const assessmentTerms = [
        'assessment skills', 'physical assessment', 'clinical assessment',
        'documentation', 'interpretation', 'evaluation', 'examination',
        'clinical findings', 'diagnostic skills', 'patient assessment'
      ];
      
      for (const term of assessmentTerms) {
        const termRegex = new RegExp(`\\b${term}\\b`, 'gi');
        if (termRegex.test(input)) {
          // Capitalize first letter
          const capitalizedTerm = term.charAt(0).toUpperCase() + term.slice(1);
          if (!extracted.some(item => item.toLowerCase().includes(term.toLowerCase()))) {
            extracted.push(capitalizedTerm);
          }
        }
      }
      
      // Clean up and deduplicate
      const cleaned = extracted
        .map(item => item.trim())
        .filter(item => item && item.length > 0)
        .map(item => {
          // Remove leading "and" or "And"
          item = item.replace(/^and\s+/i, '');
          // Capitalize first letter if not already capitalized
          return item.charAt(0).toUpperCase() + item.slice(1);
        });
      
      // Remove duplicates (case insensitive)
      const unique: string[] = [];
      for (const item of cleaned) {
        if (!unique.some(existing => existing.toLowerCase() === item.toLowerCase())) {
          unique.push(item);
        }
      }
      
      return unique.slice(0, 8); // Limit to 8 main areas
    })() : [];

    const prompt = `You are a creative, expert test item writer for ${isHealthcareSubject ? "healthcare education" : "educational"} assessments. Generate EXACTLY ${numQuestions} DIVERSE, HIGH-QUALITY exam questions for "${subject}" at ${difficulty} difficulty level.

🚨 ABSOLUTE REQUIREMENT - QUESTION TYPES:
- You MUST generate ONLY these question types: ${questionTypesStr}
- Do NOT generate any other question types
- EVERY SINGLE question must be one of: ${questionTypesStr}
- If only "multiple_choice" is specified, generate ONLY multiple choice questions
- If only "true_false" is specified, generate ONLY true/false questions
- If only "short_answer" is specified, generate ONLY short answer questions

CRITICAL: You must generate EXACTLY ${numQuestions} questions - no more, no less.

🎭 SCENARIO FORMAT SPECIFICATION - ${currentScenarioFormat.toUpperCase()} FORMAT:
${scenarioGuide.description}
📋 **Scenario Approach**: ${scenarioGuide.approach}
💡 **Question Examples**: ${scenarioGuide.examples}

📏 QUESTION LENGTH SPECIFICATION - ${questionLength.toUpperCase()} FORMAT:
${currentLengthGuide.description}

🎯 **LENGTH REQUIREMENTS**:
- **Question Style**: ${currentLengthGuide.questionStyle}
- **Rationale Style**: ${currentLengthGuide.rationaleStyle}  
- **Scenario Complexity**: ${currentLengthGuide.scenarioComplexity}

📝 **${questionLength.toUpperCase()} + ${currentScenarioFormat.toUpperCase()} FORMAT EXAMPLES**:
${currentScenarioFormat === 'source-based' ? `
🎯 SOURCE-BASED QUESTION GENERATION – STRICT FORMAT MATCHING REQUIRED
You MUST analyze the source material below and produce questions that precisely mirror its style, structure, tone, and complexity.
${context ? `
📖 SOURCE MATERIAL FOR FORMAT ANALYSIS
(Review thoroughly before generating questions)
${context.substring(0, 2500)}${context.length > 2500 ? '...[content continues]' : ''}

🔍 FORMAT ELEMENTS YOU MUST IDENTIFY AND REPLICATE:
Question Type – Are they factual/knowledge-based, application-based, or scenario-driven?
Stem Complexity – Are stems concise, moderately detailed, or highly complex?
Professional Terminology – Match the technical depth and language style.
Rationale Format – Match the level of detail, reasoning style, and explanation structure.
⚡ NON-NEGOTIABLE REQUIREMENTS:
If the source uses direct knowledge questions, produce ONLY direct knowledge questions—but vary the stem styles.
If the source uses clinical/scenario-based questions, generate ONLY scenario-based questions.
CRITICAL: Use ONLY the question types requested by user: ${questionTypes.join(', ')} - DO NOT copy question types from source material.
Maintain identical format characteristics, cognitive level, and professional tone.
Adapt answer format to match requested question type while keeping source style characteristics.
Use a diverse range of question stems (avoid repeating structures like “Which of the following…”).
Do NOT copy phrasing or content—emulate the style, not the wording.
Provide rationales that match the source’s depth, specificity, and explanatory approach.
Your output must read like it comes from the same exam blueprint as the source.
REPLICATE THE SOURCE STYLE AND CHARACTERISTICS - CREATE DIVERSE, EXAM-QUALITY QUESTIONS.
` : `
SOURCE-BASED FORMAT SELECTED but no source material provided. Defaulting to mixed format.
`}

` : currentScenarioFormat === 'scenario' ? `
Scenario-Based:
A 54-year-old woman presents with acute right-sided weakness and slurred speech. Her CT scan shows no hemorrhage. What is the most appropriate next step in management?

Use realistic situations or cases that require application of knowledge to determine the answer. Start with specific details (age, presentation, context) followed by a clear, direct question.

` : currentScenarioFormat === 'normal' ? `
Direct Knowledge:
Which Florida statute governs the licensing and regulation of bail bond agents?

Focus on facts, definitions, or core concepts that can be answered directly without complex scenarios.

` : `
Mixed Format Examples (Realistic Exam Progression):

Direct Knowledge (First 40% - Foundation):
Which Florida statute governs the licensing and regulation of bail bond agents?

Scenario-Based (Remaining 60% - Application):
A 54-year-old woman presents with acute right-sided weakness and slurred speech. Her CT scan shows no hemorrhage. What is the most appropriate next step in management?

This creates authentic exam flow: foundation → application → complex analysis

`}

 
${currentScenarioFormat === 'source-based' ? 
`🎯 **CRITICAL SOURCE-BASED FORMAT INSTRUCTIONS**:
You MUST analyze and replicate the EXACT format pattern from the provided source material.

**FORMAT MATCHING REQUIREMENTS**:
1. **Question Structure**: Match the source's overall style (direct knowledge vs scenario-based)
2. **Question Types**: CRITICAL - Use ONLY the question types requested by the user: ${questionTypes.join(', ')} - DO NOT copy question types from source
3. **Question Variety**: Use DIVERSE question stems - avoid repetitive patterns like "Which of the following"
4. **Complexity Level**: Match the cognitive difficulty and depth of the source questions
5. **Answer Choices**: Match the format, length, and style of answer options (but adapt to requested question type)
6. **Professional Language**: Use similar terminology level and subject-appropriate phrasing
7. **Rationale Format**: Match the depth and explanation style

**EXPANSION INSTRUCTIONS**:
- Use the source STYLE as the template (not exact wording patterns)
- Create DIVERSE, exam-quality question stems with variety
- Expand to cover the full subject of "${subject}" using this style approach
- Maintain the source's difficulty level and professional terminology
- Create authentic examination flow with varied question presentations

**CRITICAL**: Match the FORMAT STYLE but create DIVERSE question stems for professional exam quality.` 
: 
`IMPORTANT: Treat any provided source material as a guiding example of style, tone, terminology, and expected depth. Do NOT limit the exam to only the content found in the source. You MUST expand beyond the reference to comprehensively cover the full subject of "${subject}" — include foundational concepts, major topics, and advanced areas that may not appear in the source. When extrapolating beyond the provided material, ensure accuracy, adhere to current best practices, and produce realistic, diverse questions that reflect the broader subject domain.`}

${
  context
    ? `📚 SOURCE MATERIAL REFERENCE:
${context}

🎯 FORMAT ANALYSIS & STYLE MATCHING:
1. **Analyze the Source Material Style**:
   - Study the writing style, tone, and complexity level of the provided material
   - Identify question patterns, phrasing style, and terminology used
   - Note the level of detail and ${isHealthcareSubject ? "clinical" : "subject-specific"} specificity in scenarios
   - Observe how concepts are presented and tested

2. **Match the Reference Format**:
   - Mirror the question structure and presentation style of the source material
   - Use similar terminology, ${isHealthcareSubject ? "clinical" : "professional"} language, and professional tone
   - Maintain consistency with the complexity level and depth shown in examples
   - Follow any specific formatting patterns or question stem approaches

3. **Creative Realistic Exam Simulation**:
   - Create questions that could authentically appear on real ${subject} exams
   - Use realistic ${isHealthcareSubject ? "patient presentations, lab values, and clinical scenarios" : "case studies, data, and professional scenarios"}
   - Include contemporary ${isHealthcareSubject ? "medical practices" : "industry practices"}, current guidelines, and evidence-based approaches
   - Design questions that test practical application, not just memorization

4. **Intelligent Expansion**:
   - Build upon concepts from the source material but expand to comprehensive coverage
   - Create variations that test the same concepts in different realistic contexts
   - Include related topics and applications that would appear on actual exams
   - Ensure questions span beginner to advanced difficulty within the style framework

`
    : `🎯 COMPREHENSIVE EXAM-REALISTIC COVERAGE:
- Create questions that authentically simulate real ${subject} examination experiences
- Use contemporary, evidence-based scenarios that reflect current professional practice
- Design questions with realistic ${isHealthcareSubject ? "clinical presentations" : "professional scenarios"}, current standards, and practical applications
- Ensure comprehensive coverage across all major areas of ${subject}
- Include cutting-edge developments and current trends in the field

`
}

🏆 EXAM-AUTHENTIC CREATIVITY REQUIREMENTS:

💯 **REALISTIC EXAM SIMULATION**:
   - Create questions indistinguishable from those found on actual ${subject} examinations
   - Use authentic ${isHealthcareSubject ? "clinical scenarios with realistic patient presentations" : "professional scenarios with realistic case studies"}
   - Include accurate ${isHealthcareSubject ? "medical terminology, current drug names, and standard procedures" : "subject-specific terminology, current methods, and standard practices"}
   - Reference ${isHealthcareSubject ? "real diagnostic tests, lab values, and treatment protocols" : "real-world applications, current research, and industry standards"}
   - Present distractors that reflect common misconceptions or alternative approaches

🎨 **CREATIVE DIVERSITY MATRIX** - Each question must explore different dimensions:
${
  isHealthcareSubject
    ? `   - **Demographics**: Vary patient age (pediatric, adult, elderly), gender, ethnicity, backgrounds
   - **Clinical Settings**: Emergency dept, ICU, med-surg, outpatient, home health, specialty units  
   - **Acuity Levels**: Stable chronic conditions, acute episodes, critical emergencies
   - **Body Systems**: Systematically rotate through all relevant physiological systems
   - **Care Contexts**: Prevention, diagnosis, treatment, rehabilitation, end-of-life care
   - **Professional Roles**: Direct bedside care, patient education, family support, team collaboration`
    : `   - **Demographics**: Vary participant characteristics, backgrounds, experience levels, contexts
   - **Professional Settings**: Various work environments, institutions, practice areas, specializations
   - **Complexity Levels**: Basic concepts, intermediate applications, advanced problem-solving
   - **Subject Areas**: Systematically cover all major topics and domains within ${subject}
   - **Application Contexts**: Theory, practical application, analysis, evaluation, synthesis
   - **Professional Roles**: Different responsibilities, perspectives, and stakeholder viewpoints`
}

🌟 **ADVANCED EXAM-STYLE DISTRIBUTION**:
${
  isHealthcareSubject
    ? `   - 25% Complex clinical decision-making (priority setting, critical thinking)
   - 20% Pharmacological applications (medication management, interactions, monitoring)
   - 15% Assessment and diagnostic reasoning (physical findings, lab interpretation)
   - 15% Patient safety and risk management (error prevention, protocols)
   - 10% Communication and therapeutic relationships (patient/family interactions)
   - 10% Ethical and legal considerations (professional standards, patient rights)
   - 5% Quality improvement and evidence-based practice (current research, protocols)
   - 5% Quality improvement and research applications`
    : `   - 25% Complex problem-solving and decision-making (critical analysis, priority setting)
   - 20% Practical applications and methodologies (tools, techniques, implementations)
   - 15% Analysis and evaluation (interpretation, assessment, reasoning)
   - 15% Standards and best practices (quality assurance, protocols, guidelines)
   - 10% Communication and collaboration (stakeholder interaction, teamwork)
   - 10% Ethical and professional considerations (standards, responsibilities, regulations)
   - 5% Innovation and emerging trends (current research, new developments)
   - 5% Quality improvement and research applications`
}

💡 **INNOVATION REQUIREMENTS**:
   - Include current technology trends (telehealth, AI, mobile health)
   - Address contemporary challenges (pandemic responses, health equity)
   - Explore interdisciplinary scenarios (collaboration with other professionals)
   - Consider global health perspectives and cultural considerations
   - Include prevention, health promotion, and community health aspects

🔄 **SYSTEMATIC TOPIC ROTATION (CRITICAL FOR ${numQuestions} QUESTIONS)**:
   - Create ${Math.ceil(numQuestions/10)} distinct topic clusters
   ${currentScenarioFormat === 'mixed' ? `
   🎯 **MIXED FORMAT PROGRESSION (Realistic Exam Flow)**:
   - Questions 1-${Math.floor(numQuestions * 0.4)}: DIRECT KNOWLEDGE (foundational concepts, definitions, normal values)
   - Questions ${Math.floor(numQuestions * 0.4) + 1}-${numQuestions}: SCENARIO-BASED (clinical cases, patient presentations)
   - Within each section: rotate topics systematically
   - Create natural difficulty progression from basic recall to complex application
   - Intermix formats gradually in the transition zone (questions ${Math.floor(numQuestions * 0.3)}-${Math.floor(numQuestions * 0.5)})
   ` : `
   - Questions 1-10: Basic pathophysiology and assessment
   - Questions 11-20: Diagnostic procedures and interpretation
   - Questions 21-30: Pharmacological interventions
   - Questions 31-40: Nursing interventions and care planning
   - Questions 41-50: Patient education and discharge planning
   - Questions 51+: Advanced concepts, complications, emergencies
   `}
   - NO topic should repeat until all others are covered
   - Use different patient demographics for each question cluster

🎯 **TOPIC BREADTH MATRIX** - Ensure coverage across:
   - Basic Sciences ↔ Clinical Applications
   - Individual Care ↔ Population Health  
   - Traditional Practices ↔ Innovative Approaches
   - Physical Health ↔ Mental/Behavioral Health
   - Urban Settings ↔ Rural/Remote Care
   - Standard Protocols ↔ Complex Decision-Making

🎯 EXAM-AUTHENTIC QUALITY STANDARDS:

${
  context
    ? `� **FORMAT CONSISTENCY** (Critical for Source Material):
- Mirror the exact writing style, tone, and complexity of the provided reference material
- Match the question stem structure and answer choice formatting shown in examples
- Use identical terminology, clinical language, and professional phrasing patterns
- Maintain the same level of detail and scenario complexity as demonstrated
- Follow any specific numbering, spacing, or presentation conventions observed

`
    : ""
}🏆 **PROFESSIONAL EXAM REALISM**:
${
  isHealthcareSubject
    ? `1. 💼 **Authentic Clinical Scenarios**: Base questions on real situations professionals encounter daily
2. � **Current Evidence-Based Practice**: Reference latest guidelines, protocols, and research findings  
3. 🔬 **Accurate Medical Content**: Use precise medical terminology, current drug names, and standard procedures
4. 🎯 **Practical Application Focus**: Test decision-making skills needed in actual practice settings
5. 🌐 **Diverse Populations**: Include varied demographics, cultures, and socioeconomic backgrounds
6. ⚡ **Contemporary Challenges**: Address current healthcare issues, technology, and emerging practices
7. 🧠 **Critical Thinking Emphasis**: Require analysis, synthesis, and evaluation rather than memorization
8. 🎭 **Realistic Distractors**: Create plausible wrong answers that reflect common mistakes or alternatives`
    : `1. 💼 **Authentic Professional Scenarios**: Base questions on real situations professionals encounter in the field
2. 📚 **Current Best Practices**: Reference latest standards, guidelines, and research findings in the subject area
3. 🔬 **Accurate Subject Content**: Use precise terminology, current methods, and standard procedures
4. 🎯 **Practical Application Focus**: Test decision-making skills needed in actual professional practice
5. 🌐 **Diverse Contexts**: Include varied scenarios, environments, and applications
6. ⚡ **Contemporary Relevance**: Address current trends, technology, and emerging practices in the field
7. 🧠 **Critical Thinking Emphasis**: Require analysis, synthesis, and evaluation rather than memorization
8. 🎭 **Realistic Distractors**: Create plausible wrong answers that reflect common mistakes or alternatives`
}

🎯 **ABSOLUTE QUESTION TYPE REQUIREMENTS - NO EXCEPTIONS**:
- **ONLY and EXCLUSIVELY generate these question types**: ${questionTypesStr}
- **FORBIDDEN**: Do NOT generate ANY question type other than: ${questionTypesStr}
- **Use EXACT format**: "multiple_choice", "true_false", "short_answer" (with underscores)
- **DO NOT use**: "Multiple Choice", "True/False", "Short Answer" (avoid spaces/capitals)
- **100% COMPLIANCE**: Every single question must be one of the specified types: ${questionTypesStr}
- **VALIDATION**: Before generating each question, verify its type matches: ${questionTypesStr}

${
  isHealthcareSubject
    ? `📚 EXAM-STYLE QUESTION EXAMPLES:

REALISTIC CLINICAL SCENARIO:
{
  "questionText": "A 42-year-old patient with type 2 diabetes is admitted with diabetic ketoacidosis (DKA). Initial lab results show: glucose 485 mg/dL, pH 7.22, HCO3- 12 mEq/L, and moderate ketones. The physician orders continuous IV insulin infusion. What is the nurse's priority assessment during the first hour of treatment?",
  "questionType": "multiple_choice",
  "optionA": "Blood pressure and heart rate every 15 minutes",
  "optionB": "Capillary glucose and serum potassium levels",
  "optionC": "Urine output and specific gravity",
  "optionD": "Neurological status and level of consciousness",
  "correctAnswer": "Capillary glucose and serum potassium levels",
  "rationale": "During DKA treatment with insulin, glucose and potassium levels change rapidly and require frequent monitoring to prevent hypoglycemia and hypokalemia.",
  "points": 4
}

EVIDENCE-BASED PRACTICE EXAMPLE:
{
  "questionText": "Which medication requires monitoring of serum creatinine levels due to potential nephrotoxicity?",
  "questionType": "multiple_choice",
  "optionA": "Acetaminophen",
  "optionB": "Gentamicin",
  "optionC": "Aspirin",
  "optionD": "Prednisone",
  "correctAnswer": "Gentamicin",
  "rationale": "Gentamicin is an aminoglycoside antibiotic known for its nephrotoxic potential requiring regular renal function monitoring.",
  "points": 2
}`
    : "📚 QUESTION STYLE GUIDANCE:\n- Create questions that test real-world application of concepts\n- Use scenarios relevant to professional practice in the field\n- Include practical examples and case studies when appropriate\n- Focus on problem-solving and critical thinking skills"
}

COGNITIVE LEVELS TO TARGET:
${
  difficulty === "hybrid"
    ? `- Hybrid (Balanced Mix): 
  * 30% Easy: Knowledge Application - Apply fundamental concepts to straightforward professional situations
  * 50% Medium: Analysis & Synthesis - Analyze complex situations, compare options, integrate multiple concepts  
  * 20% Hard: Evaluation & Expert Judgment - Complex professional decision-making, prioritization, critical thinking
  * This creates a comprehensive assessment that tests learners across all cognitive levels`
    : difficulty === "easy"
      ? `- Easy: Knowledge Application (100%) - Apply fundamental concepts to straightforward professional situations`
      : difficulty === "medium"
        ? `- Medium: Analysis & Synthesis (100%) - Analyze complex situations, compare options, integrate multiple concepts`
        : `- Hard: Evaluation & Expert Judgment (100%) - Complex professional decision-making, prioritization, critical thinking`
}

COMPREHENSIVE COVERAGE REQUIREMENTS:
- Span the ENTIRE scope of "${subject}" - not just the provided source material
- Include current industry standards, best practices, and emerging trends
- Cover both theoretical foundations and practical applications
- Address safety, ethical, legal, and regulatory aspects where applicable
- Ensure questions prepare learners for real-world professional practice

${processedCoreAreas.length > 0 || domainDistribution ? `🎯 MANDATORY DOMAIN-SPECIFIC QUESTION DISTRIBUTION:

${domainDistribution ? `EXACT QUESTION DISTRIBUTION BY DOMAIN:
The following domains MUST be covered with EXACTLY the specified number of questions for each:

${Object.entries(domainDistribution).map(([domain, count]) => 
  `• ${domain}: EXACTLY ${count as number} questions (${Math.round(((count as number) / numQuestions) * 100)}% of total)`
).join('\n')}

CRITICAL DOMAIN REQUIREMENTS:
- Generate EXACTLY ${numQuestions} questions total (sum of all domains: ${Object.values(domainDistribution).reduce((a: number, b: unknown) => a + (b as number), 0)})
- STRICTLY follow the exact count for each domain - no deviation allowed
- Each domain's questions must be distinctly focused on that specific topic area
- Questions must be clearly categorizable into their assigned domain
- Create diverse scenarios within each domain to test different aspects
- NO overlap between domains - each question belongs to exactly one domain
- Ensure natural distribution prevents question duplication across domains

🔄 DOMAIN-SPECIFIC UNIQUENESS REQUIREMENTS:
- Within EACH domain, all questions must be completely unique
- Use different concepts, scenarios, and approaches for each question in a domain
- Expand each domain to identify multiple sub-concepts before generating questions
- Never repeat similar clinical scenarios, patient types, or situations within the same domain
- Each domain should feel comprehensive, not repetitive

SYSTEMATIC DOMAIN ROTATION SCHEDULE:
${Object.entries(domainDistribution).map(([domain, count], index) => {
  const startNum = Object.entries(domainDistribution).slice(0, index).reduce((sum, [, c]) => sum + (c as number), 1);
  const endNum = Object.entries(domainDistribution).slice(0, index + 1).reduce((sum, [, c]) => sum + (c as number), 0);
  return `Domain ${index + 1}: "${domain}" - Questions ${startNum} to ${endNum} (${count} questions)`;
}).join('\n')}

CRITICAL DOMAIN-SPECIFIC REQUIREMENTS - STRICT ALIGNMENT:
- Each question MUST directly and clearly relate to its assigned domain's subject matter
- Use ONLY terminology, concepts, and content from that specific domain
- Questions must be unmistakably categorized under their assigned domain
- A subject-matter expert should immediately agree the question belongs in that domain
- NEVER use generic questions that could fit multiple domains
- Read domain names literally and infer the correct discipline:
  * "Algebra Fundamentals" = algebra questions only (equations, variables, polynomials)
  * "Human Anatomy" = anatomy questions only (body structures, organs, systems)
  * "Pharmacology" = medication/drug questions only (dosages, interactions, mechanisms)
  * "Physics: Motion & Forces" = mechanics questions only (velocity, acceleration, Newton's laws)
  * "Earth Structure & Geology" = geological questions only (rocks, minerals, plate tectonics)
- Domain names may be single words, phrases, or descriptions - treat ALL as the anchor
- REJECT any question that doesn't match the domain's subject area
- If unsure about domain fit, create a new question that clearly belongs to that domain

` : `CORE TESTING AREAS COVERAGE:
The following ${processedCoreAreas.length} core areas MUST be systematically covered across your ${numQuestions} questions:
${processedCoreAreas.map((area: string) => `• ${area}`).join('\n')}

DISTRIBUTION REQUIREMENTS:
- Generate EXACTLY ${numQuestions} questions - no more, no less
- Distribute questions proportionally across ALL ${processedCoreAreas.length} core areas
- Each area should get approximately ${Math.floor(numQuestions / Math.max(processedCoreAreas.length, 1))} questions
- Create diverse scenarios within each core area to test different aspects

`}` : `CRITICAL: Generate EXACTLY ${numQuestions} questions - no more, no less. Cover the full breadth of ${subject}.

`}🚨 CRITICAL REQUIREMENTS - ZERO TOLERANCE FOR ERRORS:
- Generate EXACTLY ${numQuestions} questions - COUNT EVERY SINGLE QUESTION
- If you generate fewer than ${numQuestions}, your response is REJECTED
${domainDistribution && Object.keys(domainDistribution).length > 0 ? `- 🎯 DOMAIN COMPLIANCE: Follow the exact domain distribution specified above
- Each question must clearly belong to its assigned domain
- Domain rotation must be systematic and precise
- NO questions outside the specified domains` : ''}
- 🛑 ABSOLUTE ZERO REDUNDANCY: Each question must be completely unique in topic, scenario, focus, patient demographics, and clinical context
- 🌐 MAXIMUM DIVERSITY: Vary everything - ${isHealthcareSubject ? "age groups (pediatric/adult/elderly), genders, ethnicities, care settings (ICU/ER/outpatient/home), conditions, body systems, medications, procedures, assessment tools" : "contexts, settings, scenarios, topics, approaches, perspectives, demographics, situations"}
- 🎨 CREATIVE SCENARIOS: Avoid predictable patterns like 'A [age]-year-old patient with [condition]' - be imaginative and innovative with diverse question structures
- 🧠 SUBTOPIC DISTRIBUTION: Within each domain, cover ALL subtopics broadly - don't focus on just one area (e.g., in Cardiovascular, include cardiac disorders AND perfusion AND dysrhythmias AND anemia AND clotting disorders)
- 📚 COMPREHENSIVE COVERAGE: Span foundational to advanced concepts across ALL areas of "${subject}"
- 🧬 DOMAIN SUBTOPIC MANDATE: Each domain contains multiple subtopics - DISTRIBUTE questions across ALL subtopics:
  • Cardiovascular & Hematologic: Cardiac disorders, perfusion, dysrhythmias, anemia, clotting disorders, transfusion reactions
  • Respiratory: Oxygenation, ventilation, respiratory disorders, airway management, respiratory medications  
  • Gastrointestinal & Nutrition: Digestion, absorption, GI disorders, nutrition assessment, enteral/parenteral nutrition
  • Genitourinary: Renal function, urinary disorders, fluid/electrolyte balance, reproductive health
  • Neurosensory: Neurological assessment, cognitive function, sensory deficits, neurological disorders
  • Musculoskeletal: Mobility, fractures, joint disorders, muscle disorders, rehabilitation
  • Integumentary: Wound care, skin integrity, pressure ulcers, burn care
  • Endocrine: Hormone regulation, diabetes, thyroid disorders, adrenal disorders
  • Immune System: Infection control, immunodeficiency, autoimmune disorders, allergic reactions
  • Pharmacology: Drug classifications, administration, interactions, adverse effects
- 🔄 SYSTEMATIC DISTRIBUTION: Follow the domain distribution and question percentages strictly
- 💡 CONTEMPORARY RELEVANCE: Include current trends, technology, and real-world challenges
- Follow the ${questionLength.toUpperCase()} length requirements: ${currentLengthGuide.rationaleStyle}
- Respect the ${currentScenarioFormat.toUpperCase()} format requirements regardless of difficulty level
- MUST return valid JSON array starting with [ and ending with ]
- DO NOT include any text before or after the JSON array
- Each question must have all required fields

🎯 QUESTION COUNT VERIFICATION:
Before submitting your response, COUNT YOUR QUESTIONS:
- Required: ${numQuestions} questions
- Your count: [COUNT BEFORE SUBMITTING]
- If your count ≠ ${numQuestions}, ADD MORE QUESTIONS until you reach exactly ${numQuestions}

🚨 MANDATORY DIVERSITY REQUIREMENTS:
- Each question must test a COMPLETELY DIFFERENT concept/topic/scenario
- NO two questions should have similar patient presentations, age groups, or conditions
- NO repeated medical conditions, procedures, or diagnostic scenarios
- NO similar question stems or answer patterns
- Use systematic rotation: Question 1-Cardiology-CHF, Question 2-Pulmonology-Asthma, Question 3-Endocrine-DM, etc.
- Create a mental checklist of covered topics and avoid ALL repetition
- Each question should be distinguishable from all others by topic AND approach

CRITICAL JSON FORMAT REQUIREMENTS:
For multiple_choice questions:
- "questionType": "multiple_choice" (exactly with underscore)
- "optionA", "optionB", "optionC", "optionD" must contain the actual answer choices (NOT empty)
- "correctAnswer" must contain the EXACT TEXT of the correct option (e.g., if optionB is correct, correctAnswer should contain the same text as optionB)
- DO NOT put letters (A, B, C, D) in correctAnswer - use the full answer text
- Example: If optionB is "Gentamicin", then correctAnswer should be "Gentamicin", NOT "B"

For true_false questions:
- "questionType": "true_false" (exactly with underscore)
- "correctAnswer" should be either "True" or "False"
- optionA, optionB, optionC, optionD should be null

For short_answer questions:
- "questionType": "short_answer" (exactly with underscore)
- "correctAnswer" should contain the expected answer text
- optionA, optionB, optionC, optionD should be null

ANTI-REDUNDANCY ENFORCEMENT${
    // Add stronger enforcement for high-duplication risk scenarios
    (questionLength === 'short' || difficulty === 'easy' || getModelStrength(selectedModel) === 'weak' || numQuestions > 30) 
      ? ' - ⚠️ HIGH DUPLICATION RISK DETECTED ⚠️' : ''
  }:
- Create a mental checklist of topics covered and avoid repeating ANY aspect
- If generating many questions, systematically move through different areas of "${subject}"
- For questions 1-20: Cover core fundamentals across different contexts
- For questions 21-40: Explore specialized areas and emerging practices  
- For questions 41-60: Address complex scenarios and interdisciplinary connections
- For questions 61+: Focus on innovation, research, and cutting-edge applications
- NO two questions should address the same ${isHealthcareSubject ? "condition, procedure" : "topic, concept"}, or scenario
- Vary ${isHealthcareSubject ? "patient populations, healthcare settings" : "contexts, scenarios"}, and professional roles continuously

${
  // Add enhanced anti-duplication strategies for high-risk scenarios
  (questionLength === 'short' || difficulty === 'easy' || getModelStrength(selectedModel) === 'weak' || numQuestions > 30) 
    ? `
🚨 ENHANCED ANTI-DUPLICATION STRATEGIES (High Risk Detected):
${questionLength === 'short' ? '- SHORT QUESTIONS: Use vastly different core concepts, terms, and scenarios for each question\n- Focus on completely different aspects of each topic (mechanism vs. treatment vs. diagnosis vs. prevention)\n- Vary question stems dramatically (what/which/when/why/how/where)' : ''}
${difficulty === 'easy' ? '- EASY DIFFICULTY: Despite simpler content, ensure each question tests a unique fundamental concept\n- Rotate through different knowledge domains systematically\n- Use different clinical/professional contexts for similar concepts' : ''}
${getModelStrength(selectedModel) === 'weak' ? '- WEAKER MODEL COMPENSATION: Be extremely explicit about avoiding repetition\n- Use numbered topic checklist approach: 1) Topic A-Concept X, 2) Topic B-Concept Y, etc.\n- Force yourself to move to completely different subject areas after each question' : ''}
${numQuestions > 30 ? '- HIGH VOLUME: Create systematic subject area rotation schedule\n- Subdivide subject into ' + Math.ceil(numQuestions/10) + ' distinct areas and cycle through them\n- Track coverage: ensure no area gets > ' + Math.ceil(numQuestions/10) + ' questions' : ''}
- MANDATORY: Each question must test a COMPLETELY DIFFERENT core concept/scenario/context
- ZERO tolerance for similar phrasing, scenarios, or answer patterns
` : ''
}`;

    // Create dynamic system prompt based on subject and format
    const systemPrompt = currentScenarioFormat === 'source-based' 
      ? `You are an expert educational test item writer with 20+ years of experience in professional examination development. Your specialty is analyzing source materials to understand their STYLE characteristics and creating diverse, exam-quality questions that match the format style while using varied question stems. You excel at creating professional examination variety while maintaining consistent style characteristics. CRITICAL INSTRUCTION: When source-based format is selected, you must match the STYLE and CHARACTERISTICS of the source material but create DIVERSE question stems - avoid repetitive patterns. Create exam-quality variety within the identified format style. RESPONSE FORMAT: You must ONLY respond with valid JSON - no markdown, no explanations, no text before or after the JSON array. Always return a complete JSON array that starts with [ and ends with ].`
      : isHealthcareSubject
      ? "You are an expert medical and healthcare education test item writer with 20+ years of experience creating NCLEX, HESI, ATI, and AHIP-style questions. You specialize in writing scenario-based questions that test higher-order thinking, clinical judgment, and evidence-based practice. ANTI-DUPLICATION EXPERTISE: You excel at creating completely unique questions with no repetition in topics, scenarios, patient demographics, conditions, medications, or clinical contexts. Each question must be distinctly different. IMPORTANT: Use any provided reference only as a guiding example; expand beyond it to comprehensively cover the full subject. CRITICAL: You must ONLY respond with valid JSON - no markdown, no explanations, no text before or after the JSON array. Always return a complete JSON array that starts with [ and ends with ]."
      : `You are an expert educational test item writer with 20+ years of experience creating comprehensive, professional-quality examination questions for ${subject}. You specialize in writing questions that test understanding, application, analysis, and critical thinking. ANTI-DUPLICATION EXPERTISE: You excel at creating completely unique questions with no repetition in topics, scenarios, contexts, approaches, or subject matter. Each question must be distinctly different in focus and content. IMPORTANT: Use any provided reference only as a guiding example; expand beyond it to comprehensively cover the full subject. CRITICAL: You must ONLY respond with valid JSON - no markdown, no explanations, no text before or after the JSON array. Always return a complete JSON array that starts with [ and ends with ].`;

    // Use single-shot generation for reliability and speed with enhanced diversity
    const completion = await attemptGroqCompletion([
      { role: "system", content: systemPrompt + `\n\n🚨 CRITICAL QUESTION TYPE ENFORCEMENT: You MUST generate ONLY these question types: ${questionTypesStr}. Do NOT generate any other types. Every question must be validated against this requirement.\n\nFINAL REMINDER: Generate maximally diverse questions. Each must be completely unique in topic, scenario, patient type, condition, medication, and clinical context. Avoid any repetition or similar patterns.` },
      { role: "user", content: prompt },
    ], selectedModel, { temperature: Math.min(0.9, 0.7 + (numQuestions * 0.01)), max_tokens: 8192 });

    const responseText = completion.choices[0]?.message?.content || "";
    console.log("Raw AI Response (first 1000 chars):", responseText.substring(0, 1000));

    // Parse the JSON response with better error handling
    let questions;
    try {
      let jsonText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      if (jsonText.startsWith("[") && !jsonText.endsWith("]")) jsonText = jsonText + "]";
      let parsed = JSON.parse(jsonText);
      questions = Array.isArray(parsed) ? parsed : [parsed];
      
      // Debug: Log question types that were generated by AI
      console.log("🔍 AI Generated Question Types:", questions.map((q: any) => q.questionType));
      console.log("🎯 Expected Question Types:", questionTypes);
    } catch (err) {
      console.error("Failed to parse AI response:", err);
      return NextResponse.json({ error: "Failed to parse AI response", details: responseText.substring(0, 500) }, { status: 500 });
    }

    // Normalize final questions array
    const normalizedQuestions = questions.map((q: any, index: number) => {
      // Normalize question type
      let questionType = (q.questionType || "multiple_choice").toString().toLowerCase().trim();
      if (questionType.includes('multiple') || questionType.includes('choice')) questionType = 'multiple_choice';
      if (questionType.includes('true') || questionType.includes('false')) questionType = 'true_false';
      if (questionType.includes('short') || questionType.includes('answer')) questionType = 'short_answer';
      if (!['multiple_choice', 'true_false', 'short_answer'].includes(questionType)) {
        questionType = 'multiple_choice';
      }
      
      let correctAnswer = q.correctAnswer || q.answer || q.correct || q.solution || "";
      
      // If correctAnswer is empty for multiple choice, use first option as fallback
      if (!correctAnswer && questionType === 'multiple_choice') {
        const options = [q.optionA, q.optionB, q.optionC, q.optionD].filter(Boolean);
        if (options.length > 0) {
          correctAnswer = options[0];
        }
      }
      
      return {
        questionText: q.questionText || q.question || "",
        questionType: questionType,
        optionA: q.optionA || null,
        optionB: q.optionB || null,
        optionC: q.optionC || null,
        optionD: q.optionD || null,
        correctAnswer: correctAnswer,
        rationale: q.rationale || null,
        points: q.points || 1,
        orderIndex: index,
      };
    });

    const validQuestions = normalizedQuestions.filter((q: any) => {
      const isValid = q.questionText && q.correctAnswer;
      if (!isValid) console.log(`Question filtered out - questionText: "${q.questionText}", correctAnswer: "${q.correctAnswer}"`);
      return isValid;
    });

    console.log(`Validation filter: ${normalizedQuestions.length} -> ${validQuestions.length} questions after validation`);

    // Filter by requested question types if specified
    console.log(`🔍 Type Filtering Debug - questionTypes param: [${questionTypes?.join(', ')}]`);
    console.log(`🔍 Sample question types from validQuestions:`, validQuestions.slice(0, 3).map((q: any) => q.questionType));
    
    const typeFilteredQuestions = questionTypes?.length > 0
      ? validQuestions.filter((q: any) => {
          const isTypeMatch = questionTypes.includes(q.questionType);
          if (!isTypeMatch) {
            console.log(`❌ Question filtered out - Type: "${q.questionType}" (${typeof q.questionType}), Expected: [${questionTypes.join(', ')}]`);
          } else {
            console.log(`✅ Question accepted - Type: "${q.questionType}" matches expected types`);
          }
          return isTypeMatch;
        })
      : validQuestions;
    
    console.log(`Type filter: ${validQuestions.length} -> ${typeFilteredQuestions.length} questions after type filtering`);

    const finalQuestions = typeFilteredQuestions.slice(0, numQuestions); // Limit to exactly the requested number of questions

    // Create duplication context for adaptive thresholds - less aggressive for large sets
    const duplicationContext: DuplicationContext = {
      questionLength: questionLength as 'short' | 'medium' | 'long',
      difficulty: difficulty,
      modelStrength: getModelStrength(selectedModel),
      numQuestions: numQuestions
    };
    
    // For large question sets (>50), be less aggressive with deduplication
    if (numQuestions > 50) {
      // Log warning about potential false positives in deduplication
      console.log(`⚠️ Large question set (${numQuestions}) - using relaxed deduplication thresholds`);
    }

    // Check if domain distribution is specified for domain-by-domain generation
    if (domainDistribution && Object.keys(domainDistribution).length > 0) {
      console.log(`🎯 DOMAIN-BY-DOMAIN GENERATION: Processing ${Object.keys(domainDistribution).length} domains`);
      
      try {
        const domainUniqueQuestions = await generateDomainByDomainQuestions({
          domainDistribution,
          subject,
          difficulty,
          questionLength,
          questionTypes,
          selectedModel,
          duplicationContext,
          context,
          coreTestingAreas,
          scenarioFormat,
          isHealthcareSubject,
          numQuestions
        });
        
        if (domainUniqueQuestions.length >= Math.floor(numQuestions * 0.8)) {
          console.log(`✅ Domain-by-domain generation successful: ${domainUniqueQuestions.length} questions`);
          // Store questions for potential error recovery
          partialQuestions = domainUniqueQuestions;
          
          // Verify domain distribution in final result
          const finalDomainCounts: Record<string, number> = {};
          domainUniqueQuestions.forEach(q => {
            const domain = q.domain || 'Unknown';
            finalDomainCounts[domain] = (finalDomainCounts[domain] || 0) + 1;
          });
          console.log(`📊 Final domain distribution:`, finalDomainCounts);
          
          return NextResponse.json({
            success: true,
            questions: domainUniqueQuestions.slice(0, numQuestions),
            metadata: { 
              generated: domainUniqueQuestions.length,
              requested: numQuestions,
              generationMethod: 'domain-by-domain',
              domainDistribution,
              finalDomainCounts
            }
          });
        } else {
          console.warn(`⚠️ Domain-by-domain generation insufficient: ${domainUniqueQuestions.length}/${numQuestions}, falling back to regular generation`);
          console.log(`📊 Domain generation results:`, domainUniqueQuestions.map(q => ({ domain: q.domain, text: q.questionText?.substring(0, 50) + '...' })));
        }
      } catch (error) {
        console.error('Domain-by-domain generation failed, falling back to regular generation:', error);
      }
    }

    // Remove duplicate questions using context-aware utility
    const deduplicationResult = removeDuplicates(finalQuestions, duplicationContext);
    const uniqueQuestions = deduplicationResult.unique;

    // Store questions for potential error recovery
    partialQuestions = uniqueQuestions;

    console.log(
      `📊 Final Results: Requested: ${numQuestions}, Generated: ${questions.length}, Normalized: ${normalizedQuestions.length}, Valid: ${validQuestions.length}, Type-Filtered: ${typeFilteredQuestions.length}, Final: ${finalQuestions.length}, Unique: ${uniqueQuestions.length}`
    );
    
    // Additional logging for deduplication analysis
    if (deduplicationResult.duplicatesRemoved > 0) {
      console.log(`🔄 Deduplication Details: Removed ${deduplicationResult.duplicatesRemoved} duplicates from ${finalQuestions.length} questions`);
      const removalRate = (deduplicationResult.duplicatesRemoved / finalQuestions.length) * 100;
      console.log(`📈 Removal Rate: ${removalRate.toFixed(1)}%`);
      if (removalRate > 50) {
        console.warn(`⚠️ HIGH DUPLICATE RATE (${removalRate.toFixed(1)}%) - AI may be generating too similar questions`);
      }
      
      // If we got less than 70% of requested questions due to duplicates, suggest retry
      const fulfillmentRate = (uniqueQuestions.length / numQuestions) * 100;
      if (fulfillmentRate < 70 && removalRate > 40) {
        console.warn(`⚠️ LOW FULFILLMENT RATE: Got ${uniqueQuestions.length}/${numQuestions} questions (${fulfillmentRate.toFixed(1)}%)`);
        console.warn(`💡 SUGGESTION: Consider regenerating with more specific prompts or different approach`);
      }
    }

    // Check if we have valid questions after deduplication
    if (uniqueQuestions.length === 0) {
      return NextResponse.json(
        {
          error: "No valid questions could be generated",
          details:
            "All generated questions were missing required fields or were duplicates",
          suggestion:
            "Try simplifying your request or using a different AI model.",
        },
        { status: 500 }
      );
    }
    
    // Warn if we got fewer questions than requested
    if (uniqueQuestions.length < numQuestions) {
      console.warn(`⚠️ Generated only ${uniqueQuestions.length} out of ${numQuestions} requested questions`);
      
      // Log specific guidance for reducing duplicates
      const shortfall = numQuestions - uniqueQuestions.length;
      console.warn(`❌ SHORTFALL: Missing ${shortfall} questions due to duplicates and filtering`);
      console.warn(`💡 ANTI-DUPLICATION TIPS: Ensure questions vary in:`);
      console.warn(`   • Patient demographics (age, gender, ethnicity)`);
      console.warn(`   • Clinical settings (ICU, ER, outpatient, home)`);
      console.warn(`   • Medical conditions and body systems`);
      console.warn(`   • Question stems and formats`);
      console.warn(`   • Interventions and assessments`);
      
      if (typeFilteredQuestions.length < validQuestions.length) {
        console.warn(`⚠️ ${validQuestions.length - typeFilteredQuestions.length} questions were filtered out due to wrong question type`);
      }
    }

    // Check if we got fewer questions than requested (partial content scenario)
    const isPartialContent = uniqueQuestions.length < numQuestions;

    return NextResponse.json({
      success: true,
      questions: uniqueQuestions,
      metadata: {
        subject,
        difficulty,
        numQuestions: uniqueQuestions.length,
        requestedQuestions: numQuestions,
        isPartialContent,
        duplicatesRemoved: deduplicationResult.duplicatesRemoved,
      },
      ...(isPartialContent && {
        warning: `Generated ${uniqueQuestions.length} out of ${numQuestions} requested questions.${
          deduplicationResult.duplicatesRemoved > 0
            ? ` Removed ${deduplicationResult.duplicatesRemoved} duplicate questions.`
            : " The AI response may have been truncated."
        }`,
        suggestion:
          "Try reducing the number of questions or using a faster model for complete results.",
      }),
    });
  } catch (error: any) {
    console.error("Error generating questions:", error);

    // If we have partial questions from earlier processing, return them with error
    if (partialQuestions && partialQuestions.length > 0) {
      return NextResponse.json(
        {
          error: "Partial generation error",
          details: error.message,
          questions: partialQuestions,
          metadata: {
            numQuestions: partialQuestions.length,
            isPartialContent: true,
          },
          warning: `Error occurred during generation. Displaying ${partialQuestions.length} questions that were successfully generated.`,
        },
        { status: 200 } // Return 200 so frontend processes the questions
      );
    }

    return NextResponse.json(
      { error: "Failed to generate questions", details: error.message },
      { status: 500 }
    );
  }
}

// Handle streaming question generation
async function handleStreamingGeneration(request: NextRequest, body: any) {
  try {
    // Check authentication
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { subject, difficulty, questionLength, numQuestions, context, coreTestingAreas, questionTypes, model, scenarioFormat, domainDistribution } = body;

    // Process core testing areas with intelligent extraction (same logic as main route)
    const processedCoreAreas = coreTestingAreas ? (() => {
      const input = coreTestingAreas.trim();
      
      // If it's already a bullet list, use existing logic
      if (input.includes('\n') && (input.includes('•') || input.includes('-') || input.includes('*'))) {
        return input
          .split('\n')
          .map((area: string) => area.trim())
          .filter((area: string) => area && area.length > 0)
          .map((area: string) => {
            // Remove existing bullet points or dashes
            const cleaned = area.replace(/^[•\-\*]\s*/, '').trim();
            // Extract key points (split by commas, semicolons, or "and")
            const keyPoints = cleaned
              .split(/[,;]|\s+and\s+/i)
              .map(point => point.trim())
              .filter(point => point.length > 0)
              .slice(0, 3); // Limit to 3 key points per area
            return keyPoints.length > 1 ? keyPoints.join(', ') : cleaned;
          })
          .slice(0, 8); // Limit to 8 main areas
      }
      
      // Otherwise, use intelligent paragraph extraction
      const extracted = [];
      
      // Extract content within parentheses
      const parenthesesRegex = /\(([^)]+)\)/g;
      let match;
      while ((match = parenthesesRegex.exec(input)) !== null) {
        const content = match[1].trim();
        if (content.includes(',')) {
          // Split by comma and clean up
          const items = content.split(',').map(item => item.trim());
          extracted.push(...items);
        } else {
          extracted.push(content);
        }
      }
      
      // Extract items after "including" (case insensitive)
      const includingRegex = /including\s+([^.]+)/gi;
      while ((match = includingRegex.exec(input)) !== null) {
        const content = match[1].trim();
        
        // Remove parenthetical content since we already extracted it
        const cleanContent = content.replace(/\([^)]*\)/g, '').trim();
        
        if (cleanContent.includes(',')) {
          const items = cleanContent.split(',').map(item => item.trim()).filter(item => item);
          extracted.push(...items);
        } else if (cleanContent) {
          extracted.push(cleanContent);
        }
      }
      
      // Extract key assessment terms
      const assessmentTerms = [
        'assessment skills', 'physical assessment', 'clinical assessment',
        'documentation', 'interpretation', 'evaluation', 'examination',
        'clinical findings', 'diagnostic skills', 'patient assessment'
      ];
      
      for (const term of assessmentTerms) {
        const termRegex = new RegExp(`\\b${term}\\b`, 'gi');
        if (termRegex.test(input)) {
          // Capitalize first letter
          const capitalizedTerm = term.charAt(0).toUpperCase() + term.slice(1);
          if (!extracted.some(item => item.toLowerCase().includes(term.toLowerCase()))) {
            extracted.push(capitalizedTerm);
          }
        }
      }
      
      // Clean up and deduplicate
      const cleaned = extracted
        .map(item => item.trim())
        .filter(item => item && item.length > 0)
        .map(item => {
          // Remove leading "and" or "And"
          item = item.replace(/^and\s+/i, '');
          // Capitalize first letter if not already capitalized
          return item.charAt(0).toUpperCase() + item.slice(1);
        });
      
      // Remove duplicates (case insensitive)
      const unique: string[] = [];
      for (const item of cleaned) {
        if (!unique.some(existing => existing.toLowerCase() === item.toLowerCase())) {
          unique.push(item);
        }
      }
      
      return unique.slice(0, 8); // Limit to 8 main areas
    })() : [];

    // Validate input
    if (!subject || !difficulty || !numQuestions) {
      return NextResponse.json(
        { error: "Missing required fields: subject, difficulty, numQuestions" },
        { status: 400 }
      );
    }

    // Create a ReadableStream for Server-Sent Events
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial status
          controller.enqueue(`data: ${JSON.stringify({ 
            type: 'status', 
            message: 'Starting question generation...',
            progress: 0 
          })}\n\n`);

          // Generate questions in batches for better streaming experience
          const batchSize = Math.max(1, Math.min(5, Math.floor(numQuestions / 10))); // 1-5 questions per batch
          const totalBatches = Math.ceil(numQuestions / batchSize);
          
          let allQuestions: any[] = [];
          
          for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const questionsInBatch = Math.min(batchSize, numQuestions - allQuestions.length);
            const progress = Math.round((batchIndex / totalBatches) * 100);
            
            // Send progress update
            controller.enqueue(`data: ${JSON.stringify({ 
              type: 'progress', 
              message: `Generating batch ${batchIndex + 1} of ${totalBatches} (${questionsInBatch} questions)...`,
              progress: progress,
              questionsGenerated: allQuestions.length,
              totalQuestions: numQuestions
            })}\n\n`);

            // Generate batch of questions
            const batchQuestions = await generateQuestionBatch({
              subject,
              difficulty,
              questionLength,
              numQuestions: questionsInBatch,
              context,
              coreTestingAreas: processedCoreAreas.length > 0 ? processedCoreAreas.join('\n') : coreTestingAreas,
              questionTypes,
              model,
              scenarioFormat,
              batchIndex,
              totalBatches,
              existingQuestions: allQuestions,
              domainDistribution
            });

            // Add to all questions
            allQuestions.push(...batchQuestions);

            // Stream each question as it's generated
            for (const question of batchQuestions) {
              controller.enqueue(`data: ${JSON.stringify({ 
                type: 'question', 
                question: question,
                totalGenerated: allQuestions.length,
                totalRequested: numQuestions
              })}\n\n`);
              
              // Small delay to make streaming more visible
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }

          // Perform global duplicate check across all domains before final save
          console.log(`🔍 Performing global duplicate check on ${allQuestions.length} questions from all domains...`);
          
          const globalDeduplicationContext: DuplicationContext = {
            questionLength,
            difficulty,
            modelStrength: getModelStrength(model),
            numQuestions: allQuestions.length
          };

          const globalDeduplicationResult = removeDuplicates(allQuestions, globalDeduplicationContext);
          const finalQuestions = globalDeduplicationResult.unique;
          
          if (globalDeduplicationResult.duplicatesRemoved > 0) {
            console.log(`🚫 Global Deduplication: Removed ${globalDeduplicationResult.duplicatesRemoved} cross-domain duplicates`);
            console.log(`📊 Final count after global deduplication: ${finalQuestions.length} questions`);
            
            // Notify about global deduplication
            controller.enqueue(`data: ${JSON.stringify({ 
              type: 'global_deduplication', 
              message: `Removed ${globalDeduplicationResult.duplicatesRemoved} cross-domain duplicates`,
              duplicatesRemoved: globalDeduplicationResult.duplicatesRemoved,
              finalCount: finalQuestions.length
            })}\n\n`);
          } else {
            console.log(`✅ Global Deduplication: No cross-domain duplicates found`);
          }

          // Send completion message with final deduplicated questions
          controller.enqueue(`data: ${JSON.stringify({ 
            type: 'complete', 
            message: `Successfully generated ${finalQuestions.length} questions!`,
            totalQuestions: finalQuestions.length,
            questions: finalQuestions,
            globalDuplicatesRemoved: globalDeduplicationResult.duplicatesRemoved
          })}\n\n`);

        } catch (error: any) {
          // Send error message
          controller.enqueue(`data: ${JSON.stringify({ 
            type: 'error', 
            message: error.message || 'Failed to generate questions',
            error: true
          })}\n\n`);
        } finally {
          controller.close();
        }
      }
    });

    // Return Server-Sent Events response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to start streaming generation", details: error.message },
      { status: 500 }
    );
  }
}

// Generate a batch of questions
async function generateQuestionBatch(params: {
  subject: string;
  difficulty: string;
  questionLength: string;
  numQuestions: number;
  context: string;
  coreTestingAreas: string;
  questionTypes: string[];
  model: string;
  scenarioFormat?: string;
  batchIndex: number;
  totalBatches: number;
  existingQuestions: any[];
  domainDistribution?: {[key: string]: number};
}) {
  const {
    subject,
    difficulty,
    questionLength,
    numQuestions,
    context,
    coreTestingAreas,
    questionTypes,
    model,
    scenarioFormat,
    batchIndex,
    totalBatches,
    existingQuestions,
    domainDistribution
  } = params;

  // Use provided model or default to working model
  const selectedModel = model || "gpt-oss-20b-128k";
  
  // Build the prompt for this batch
  const questionTypesStr = questionTypes?.length
    ? questionTypes.join(", ")
    : "multiple_choice";

  // Question length requirements
  const questionLengthGuide = {
    "very-short": {
      description: "Ultra-concise questions with minimal text",
      questionStyle: "Keep question stems under 25 words. Use only essential information.",
      rationaleStyle: "Rationales should be 1 brief sentence (8-12 words maximum).",
    },
    short: {
      description: "Concise, direct questions with brief explanations",
      questionStyle: "Keep question stems under 50 words. Use straightforward scenarios without excessive detail.",
      rationaleStyle: "Rationales should be 1 concise sentence (10-15 words maximum).",
    },
    "short-medium": {
      description: "Slightly expanded questions with focused explanations",
      questionStyle: "Question stems should be 40-70 words. Include key context but stay focused.",
      rationaleStyle: "Rationales should be 1-2 sentences (15-25 words maximum).",
    },
    medium: {
      description: "Balanced questions with moderate detail and explanations", 
      questionStyle: "Question stems should be 50-100 words. Include necessary context but avoid excessive detail.",
      rationaleStyle: "Rationales should be 1-2 clear sentences (20-30 words maximum).",
    },
    "medium-long": {
      description: "Expanded questions with detailed context and explanations",
      questionStyle: "Question stems should be 80-130 words. Include comprehensive context and scenarios.",
      rationaleStyle: "Rationales should be 2-3 sentences (30-45 words maximum).",
    },
    long: {
      description: "Detailed, comprehensive questions with thorough explanations",
      questionStyle: "Question stems can be 100-200 words. Include comprehensive scenarios with detailed background information.",
      rationaleStyle: "Rationales should be 2-3 detailed sentences (40-60 words maximum) with thorough explanations.",
    },
    "very-long": {
      description: "Extensive questions with maximum detail and comprehensive explanations",
      questionStyle: "Question stems can be 150-250 words. Include extensive scenarios with rich background detail.",
      rationaleStyle: "Rationales should be 3-4 comprehensive sentences (50-80 words maximum).",
    },
    hybrid: {
      description: "Mixed length questions combining all formats for variety",
      questionStyle: "Vary question stems from 25-200 words across the batch. Mix ultra-concise with detailed scenarios.",
      rationaleStyle: "Vary rationale length from brief (8-12 words) to comprehensive (50-80 words) for diversity.",
    }
  };

  const lengthGuide = questionLengthGuide[questionLength as keyof typeof questionLengthGuide] || questionLengthGuide.medium;

  // Determine scenario format for this batch
  const scenarioFormatGuide = {
    'scenario': {
      description: "Create scenario-based questions using realistic situations or cases that require application of knowledge",
      instruction: "Every question should present a realistic scenario with specific details (age, presentation, context) followed by a clear, direct question. Example: 'A 54-year-old woman presents with acute right-sided weakness and slurred speech. Her CT scan shows no hemorrhage. What is the most appropriate next step in management?'"
    },
    'normal': {
      description: "Create direct knowledge questions that focus on facts, definitions, or core concepts",
      instruction: "Focus on straightforward questions that can be answered directly without complex scenarios. Example: 'Which Florida statute governs the licensing and regulation of bail bond agents?'"
    },
    'mixed': {
      description: "Create a mix of scenario-based and normal questions",
      instruction: "Generate approximately 60% scenario-based questions and 40% direct knowledge questions for balanced assessment."
    }
  };

  const currentScenarioFormat = scenarioFormat || 'mixed';
  const scenarioGuide = scenarioFormatGuide[currentScenarioFormat as keyof typeof scenarioFormatGuide] || scenarioFormatGuide.mixed;

  // Create topics covered list to avoid duplication
  const existingTopics = existingQuestions.map(q => 
    q.questionText.toLowerCase().split(' ').slice(0, 5).join(' ')
  );

  const prompt = `You are an expert exam question writer. Generate EXACTLY ${numQuestions} unique, high-quality exam questions for "${subject}" at ${difficulty} difficulty level.

SCENARIO FORMAT REQUIREMENTS (${currentScenarioFormat.toUpperCase()}):
- ${scenarioGuide.description}
- ${scenarioGuide.instruction}
${currentScenarioFormat === 'mixed' ? `
🎯 MIXED FORMAT BATCH POSITIONING:
- Current batch: ${batchIndex + 1} of ${totalBatches}
- Questions generated so far: ${existingQuestions.length}
- Total target: ${existingQuestions.length + numQuestions}
- Use ${existingQuestions.length < Math.floor((existingQuestions.length + numQuestions) * 0.4) ? 'DIRECT KNOWLEDGE' : existingQuestions.length > Math.floor((existingQuestions.length + numQuestions) * 0.6) ? 'SCENARIO-BASED' : 'MIXED DIRECT AND SCENARIOS'} format for this batch
` : ''}

QUESTION LENGTH REQUIREMENTS (${questionLength.toUpperCase()}):
- ${lengthGuide.description}
- ${lengthGuide.questionStyle}
- ${lengthGuide.rationaleStyle}

BATCH CONTEXT:
- This is batch ${batchIndex + 1} of ${totalBatches}
- ${existingQuestions.length} questions already generated
- Ensure NO overlap with existing topics: [${existingTopics.slice(-5).join(', ')}...]

${context ? `SOURCE MATERIAL:\n${context}\n` : ''}
${domainDistribution && Object.keys(domainDistribution).length > 0 ? `
🎯 DOMAIN-SPECIFIC BATCH REQUIREMENTS:

This batch should generate questions from the following domains in proportion to the total exam:
${Object.entries(domainDistribution).map(([domain, count]) => 
  `• ${domain}: ${count as number} questions total (${Math.round(((count as number) / Object.values(domainDistribution).reduce((a: number, b: unknown) => a + (b as number), 0)) * 100)}% of exam)`
).join('\n')}

For this batch (${batchIndex + 1} of ${totalBatches}):
- Focus on domains that haven't been fully covered yet
- Ensure balanced representation across all specified domains
- Track which domains still need questions in remaining batches

` : coreTestingAreas ? `CORE TESTING AREAS TO COVER:\n${coreTestingAreas.split('\n').map((area: string) => area.trim()).filter((area: string) => area).map((area: string) => `- ${area.replace(/^[•\-\*]\s*/, '')}`).join('\n')}\n\nEnsure this batch covers relevant aspects from these core areas.\n` : ''}

🚨 CRITICAL QUESTION TYPE REQUIREMENT:
- Generate ONLY these question types: ${questionTypesStr}
- Do NOT generate any other question types
- Every question must be one of: ${questionTypesStr}

REQUIREMENTS:
- Question types: ${questionTypesStr}
- Each question must be completely unique
- Cover different aspects of ${subject}
- ${lengthGuide.rationaleStyle}
- Return valid JSON array only

JSON FORMAT REQUIREMENTS:
- questionType must be EXACTLY one of: ${questionTypesStr} (with underscores)
- correctAnswer must be the FULL TEXT of the correct option (not A, B, C, D)
- For multiple_choice: include optionA, optionB, optionC, optionD with complete text

[
  {
    "questionText": "...",
    "questionType": "multiple_choice",
    "optionA": "Complete option text here",
    "optionB": "Complete option text here", 
    "optionC": "Complete option text here",
    "optionD": "Complete option text here",
    "correctAnswer": "Complete option text here (same as one of the options above)",
    "rationale": "brief explanation",
    "points": 1
  }
]

CRITICAL: Return ONLY the JSON array, no markdown, no explanations.`;

  // Call Groq API
  const completion = await attemptGroqCompletion([
    {
      role: "system",
      content: `You are an expert educational test item writer. 🚨 CRITICAL QUESTION TYPE ENFORCEMENT: You MUST generate ONLY these question types: ${questionTypesStr}. Do NOT generate any other types. Every question must be validated against this requirement. CRITICAL: You must ONLY respond with valid JSON - no markdown, no explanations, no text before or after the JSON array.`
    },
    {
      role: "user",
      content: prompt
    }
  ], selectedModel, { temperature: 0.7, max_tokens: 8192 });

  const responseText = completion.choices[0]?.message?.content || "";
  
  // Parse and normalize questions
  try {
    let jsonText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const questions = JSON.parse(jsonText);
    
    if (!Array.isArray(questions)) {
      throw new Error("Response is not an array");
    }

    // Normalize and validate questions
    console.log(`Streaming batch: Raw questions received: ${questions.length}`);
    
    const filtered = questions.filter((q: any) => q && (q.questionText || q.question));
    console.log(`Streaming batch: After initial filter: ${filtered.length}`);
    
    const normalized = filtered.map((q: any, index: number) => {
      // Normalize question type to underscore format
      let questionType = (q.questionType || "multiple_choice").toString().toLowerCase();
      if (questionType === 'multiple choice') questionType = 'multiple_choice';
      if (questionType === 'true/false') questionType = 'true_false';
      if (questionType === 'short answer') questionType = 'short_answer';
      if (questionType === 'fill in the blank') questionType = 'short_answer';
      
      // Try to extract correct answer with fallbacks
      let correctAnswer = q.correctAnswer || q.answer || q.correct || q.solution || q.correctOption || "";
      
      // If correctAnswer is empty but we have options, try to find it
      if (!correctAnswer && questionType === "multiple_choice") {
        // Look for marked correct option (with asterisk or similar)
        const options = [q.optionA, q.optionB, q.optionC, q.optionD].filter(Boolean);
        const markedOption = options.find(opt => opt && (opt.includes('*') || opt.includes('\u2713')));
        if (markedOption) {
          correctAnswer = markedOption.replace(/[*\u2713]/g, '').trim();
        } else if (options.length > 0) {
          // Fallback: use first option
          correctAnswer = options[0];
          console.log(`Streaming Warning: No correct answer found, using first option as fallback: "${correctAnswer}"`);
        }
      }
      
      const result = {
        questionText: q.questionText || q.question || "",
        questionType: questionType,
        optionA: q.optionA || null,
        optionB: q.optionB || null,
        optionC: q.optionC || null,
        optionD: q.optionD || null,
        correctAnswer: correctAnswer,
        rationale: q.rationale || null,
        points: q.points || 1,
        orderIndex: existingQuestions.length + index,
      };
      console.log(`Streaming question ${index}: questionText="${result.questionText.substring(0, 30)}...", correctAnswer="${result.correctAnswer}", type="${result.questionType}"`);
      return result;
    });
    
    const validated = normalized.filter((q: any) => {
      const isValid = q.questionText && q.correctAnswer;
      if (!isValid) {
        console.log(`Streaming question filtered out - questionText: "${q.questionText}", correctAnswer: "${q.correctAnswer}"`);
      }
      return isValid;
    });
    
    console.log(`Streaming batch: After validation: ${validated.length}`);
    
    // Filter by question types if specified
    const typeFiltered = questionTypes?.length > 0 
      ? validated.filter((q: any) => {
          const isTypeMatch = questionTypes.includes(q.questionType);
          if (!isTypeMatch) {
            console.log(`Streaming question filtered out - wrong type: "${q.questionType}", expected: [${questionTypes.join(', ')}]`);
          }
          return isTypeMatch;
        })
      : validated;
    
    console.log(`Streaming batch: After type filtering: ${typeFiltered.length}`);
    return typeFiltered.slice(0, numQuestions);
      
  } catch (error) {
    console.error("Error parsing batch response:", error);
    return []; // Return empty array if parsing fails
  }
}

// Domain-by-domain generation with strict uniqueness within each domain
async function generateDomainByDomainQuestions(params: {
  domainDistribution: Record<string, number>,
  subject: string,
  difficulty: string,
  questionLength: string,
  questionTypes: string[],
  selectedModel: string,
  duplicationContext: DuplicationContext,
  context?: string,
  coreTestingAreas?: string,
  scenarioFormat?: string,
  isHealthcareSubject: boolean,
  numQuestions: number
}): Promise<any[]> {
  const {
    domainDistribution,
    subject,
    difficulty,
    questionLength,
    questionTypes,
    selectedModel,
    duplicationContext,
    context,
    coreTestingAreas,
    scenarioFormat,
    isHealthcareSubject,
    numQuestions
  } = params;

  const allDomainQuestions: any[] = [];
  
  // Process each domain individually
  for (const [domainName, targetCount] of Object.entries(domainDistribution)) {
    console.log(`🎯 Processing Domain: ${domainName} (Target: ${targetCount} questions)`);
    
    // Expand domain to identify concepts and prevent duplicates
    const expandedDomain = await expandDomainConcepts(domainName, subject, isHealthcareSubject);
    console.log(`🔍 Domain Expansion for ${domainName}:`, expandedDomain.slice(0, 5).join(', '), '...');
    
    const domainQuestions: any[] = [];
    let attempts = 0;
    const maxAttempts = Math.max(5, targetCount * 2); // Allow multiple attempts per question
    
    while (domainQuestions.length < targetCount && attempts < maxAttempts) {
      attempts++;
      const questionsNeeded = targetCount - domainQuestions.length;
      const batchSize = Math.min(questionsNeeded * 2, 10); // Generate extra to account for filtering

      console.log(`📝 Domain ${domainName} - Attempt ${attempts}: Need ${questionsNeeded} more questions, generating batch of ${batchSize}`);

      try {
        // Generate questions specifically for this domain
        const batchQuestions = await generateDomainSpecificQuestions({
          domainName,
          expandedDomain,
          batchSize,
          subject,
          difficulty,
          questionLength,
          questionTypes,
          selectedModel,
          context,
          scenarioFormat,
          isHealthcareSubject,
          existingQuestions: domainQuestions
        });

        // Filter and validate questions for this domain
        for (const newQuestion of batchQuestions) {
          if (domainQuestions.length >= targetCount) break;

          // Check if this question is unique within the current domain
          const testArray = [...domainQuestions, newQuestion];
          const deduplicationResult = removeDuplicates(testArray, duplicationContext);
          const isDuplicateInDomain = deduplicationResult.unique.length === domainQuestions.length;

          if (!isDuplicateInDomain) {
            domainQuestions.push(newQuestion);
            console.log(`✅ Domain ${domainName}: Added unique question ${domainQuestions.length}/${targetCount}`);
          } else {
            console.log(`❌ Domain ${domainName}: Rejected duplicate question`);
          }
        }

        if (batchQuestions.length === 0) {
          console.warn(`⚠️ Domain ${domainName}: No questions generated in batch`);
        }
      } catch (err: any) {
        // If a transient upstream 504 occurred, apply exponential backoff and retry
        if (err?.isUpstream504 || (err?.message && err.message.includes('Upstream model gateway timeout'))) {
          const backoffMs = Math.min(60000, 2000 * Math.pow(2, attempts)); // cap at 60s
          console.warn(`🚧 Transient upstream error for domain ${domainName}: ${err.message || err}. Backing off ${backoffMs}ms and retrying (attempt ${attempts}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue; // retry
        }

        console.error(`Domain ${domainName}: Generation failed with non-retryable error:`, err?.message || err);
        // For non-transient errors, break to avoid tight loop
        break;
      }
    }
    
    if (domainQuestions.length < targetCount) {
      console.warn(`⚠️ Domain ${domainName}: Only generated ${domainQuestions.length}/${targetCount} questions after ${attempts} attempts`);
    } else {
      console.log(`✅ Domain ${domainName}: Successfully generated ${domainQuestions.length}/${targetCount} unique questions`);
    }
    
    // Add domain metadata to questions
    const domainQuestionsWithMetadata = domainQuestions.map(q => ({
      ...q,
      domain: domainName,
      domainIndex: allDomainQuestions.length
    }));
    
    allDomainQuestions.push(...domainQuestionsWithMetadata);
  }
  
  console.log(`🎯 DOMAIN-BY-DOMAIN COMPLETE: Generated ${allDomainQuestions.length} total questions across ${Object.keys(domainDistribution).length} domains`);
  return allDomainQuestions;
}

// Expand domain into specific concepts to prevent duplicates
async function expandDomainConcepts(domainName: string, subject: string, isHealthcareSubject: boolean): Promise<string[]> {
  const commonConcepts: string[] = [];
  
  // Healthcare-specific domain expansion
  if (isHealthcareSubject) {
    const healthcareConcepts: Record<string, string[]> = {
      'cardiovascular': ['heart failure', 'myocardial infarction', 'hypertension', 'arrhythmias', 'cardiac catheterization', 'ECG interpretation', 'blood pressure management', 'anticoagulation'],
      'respiratory': ['COPD', 'asthma', 'pneumonia', 'respiratory failure', 'oxygen therapy', 'ventilator management', 'chest tubes', 'pulmonary embolism'],
      'endocrine': ['diabetes mellitus', 'thyroid disorders', 'adrenal dysfunction', 'insulin management', 'blood glucose monitoring', 'diabetic ketoacidosis', 'hypoglycemia'],
      'neurological': ['stroke', 'seizures', 'head injury', 'spinal cord injury', 'neurological assessment', 'ICP monitoring', 'Glasgow Coma Scale'],
      'renal': ['kidney failure', 'dialysis', 'fluid balance', 'electrolyte imbalances', 'urinary tract infection', 'nephritis', 'renal stones'],
      'gastrointestinal': ['GI bleeding', 'bowel obstruction', 'peptic ulcers', 'inflammatory bowel disease', 'liver disease', 'pancreatitis', 'nutrition'],
      'musculoskeletal': ['fractures', 'joint disorders', 'mobility', 'pain management', 'orthopedic surgery', 'physical therapy', 'immobility complications'],
      'mental health': ['depression', 'anxiety', 'bipolar disorder', 'schizophrenia', 'suicide risk', 'therapeutic communication', 'psychiatric medications'],
      'maternal': ['pregnancy complications', 'labor and delivery', 'postpartum care', 'breastfeeding', 'neonatal care', 'family planning'],
      'pediatric': ['growth and development', 'immunizations', 'pediatric emergencies', 'child safety', 'congenital disorders', 'adolescent health'],
      'pharmacology': ['medication administration', 'drug interactions', 'side effects', 'dosage calculations', 'IV therapy', 'pain medications', 'antibiotics'],
      'leadership': ['delegation', 'prioritization', 'conflict resolution', 'quality improvement', 'ethical decision making', 'team communication', 'resource management']
    };
    
    const domainLower = domainName.toLowerCase();
    for (const [key, concepts] of Object.entries(healthcareConcepts)) {
      if (domainLower.includes(key)) {
        commonConcepts.push(...concepts);
      }
    }
  }
  
  // General subject-specific expansion
  if (commonConcepts.length === 0) {
    // Create generic concept expansion based on domain name
    const domainWords = domainName.toLowerCase().split(/[\s\-_]+/);
    
    // Add variations and related terms
    for (const word of domainWords) {
      commonConcepts.push(
        word + ' principles',
        word + ' applications',
        word + ' theory',
        word + ' practice',
        word + ' methods',
        word + ' analysis',
        word + ' evaluation',
        word + ' implementation'
      );
    }
  }
  
  // Ensure we have at least 8 concepts per domain
  while (commonConcepts.length < 8) {
    commonConcepts.push(
      `${domainName} fundamentals`,
      `${domainName} advanced concepts`,
      `${domainName} best practices`,
      `${domainName} troubleshooting`,
      `${domainName} case studies`,
      `${domainName} innovations`,
      `${domainName} standards`,
      `${domainName} procedures`
    );
  }
  
  return commonConcepts.slice(0, 20); // Limit to top 20 concepts
}

// Generate questions specifically for a single domain
async function generateDomainSpecificQuestions(params: {
  domainName: string,
  expandedDomain: string[],
  batchSize: number,
  subject: string,
  difficulty: string,
  questionLength: string,
  questionTypes: string[],
  selectedModel: string,
  context?: string,
  scenarioFormat?: string,
  isHealthcareSubject: boolean,
  existingQuestions: any[]
}): Promise<any[]> {
  const {
    domainName,
    expandedDomain,
    batchSize,
    subject,
    difficulty,
    questionLength,
    questionTypes,
    selectedModel,
    context,
    scenarioFormat,
    isHealthcareSubject,
    existingQuestions
  } = params;

  const questionTypesStr = questionTypes.join(", ");
  const currentScenarioFormat = scenarioFormat || 'mixed';
  
  // Create existing topics list to avoid duplication
  const existingTopics = existingQuestions.map(q => 
    q.questionText.toLowerCase().split(' ').slice(0, 8).join(' ')
  );

  const prompt = `You are an expert examination question writer specializing in domain-specific content generation. Generate EXACTLY ${batchSize} unique, high-quality questions for the "${domainName}" domain within the subject of "${subject}" at ${difficulty} difficulty level.

🎯 DOMAIN-SPECIFIC REQUIREMENTS:
- **EXCLUSIVE FOCUS**: ALL questions must be specifically about "${domainName}"
- **DOMAIN CONCEPTS**: Use these domain-specific concepts and expand upon them: ${expandedDomain.slice(0, 10).join(', ')}
- **UNIQUENESS WITHIN DOMAIN**: Each question must address a DIFFERENT aspect, concept, or scenario within "${domainName}"
- **NO CROSS-DOMAIN**: Questions must NOT include concepts from other domains outside "${domainName}"

🚨 CRITICAL QUESTION TYPE REQUIREMENT:
- Generate ONLY these question types: ${questionTypesStr}
- Every question must be one of: ${questionTypesStr}

📋 UNIQUENESS ENFORCEMENT:
- Avoid these existing topics already covered: [${existingTopics.slice(-5).join(', ')}...]
- Each question must test a DIFFERENT concept/scenario within "${domainName}"
- Use varied question stems, approaches, and focus areas
- NO repetition of clinical scenarios, patient demographics, or specific situations (if healthcare)

🔍 DOMAIN EXPANSION STRATEGY:
For "${domainName}", create questions covering:
1. **Fundamental concepts** specific to this domain
2. **Practical applications** within this domain
3. **Problem-solving scenarios** unique to this domain  
4. **Advanced concepts** or specialized aspects
5. **Current practices** and standards in this domain
6. **Critical thinking** applications within this domain

${context ? `📖 REFERENCE MATERIAL:\n${context}\n` : ''}

RESPONSE FORMAT: Return ONLY a valid JSON array with ${batchSize} questions. No markdown, no explanations.

[
  {
    "questionText": "Domain-specific question text here...",
    "questionType": "${questionTypes[0]}",
    "optionA": "Option A text" (if multiple choice),
    "optionB": "Option B text" (if multiple choice),
    "optionC": "Option C text" (if multiple choice), 
    "optionD": "Option D text" (if multiple choice),
    "correctAnswer": "Exact text of correct answer",
    "rationale": "Domain-specific explanation",
    "points": 1
  }
]`;

  try {
    const completion = await attemptGroqCompletion([
      { 
        role: "system", 
        content: `You are an expert domain-specific educational test item writer. CRITICAL: Generate questions ONLY about "${domainName}" within "${subject}". Every question must be clearly and exclusively related to this specific domain. You must ONLY respond with valid JSON - no markdown, no explanations, no text before or after the JSON array.` 
      },
      { role: "user", content: prompt }
    ], selectedModel, { temperature: 0.8, max_tokens: 8192 });

    const responseText = completion.choices[0]?.message?.content || "";
    
    // Parse the JSON response
    let questions;
    try {
      let jsonText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      if (jsonText.startsWith("[") && !jsonText.endsWith("]")) jsonText = jsonText + "]";
      let parsed = JSON.parse(jsonText);
      questions = Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      console.error(`Failed to parse domain-specific response for ${domainName}:`, err);
      return [];
    }

    // Normalize and validate domain questions
    const normalizedQuestions = questions.map((q: any, index: number) => {
      let questionType = (q.questionType || "multiple_choice").toString().toLowerCase().trim();
      if (questionType.includes('multiple') || questionType.includes('choice')) questionType = 'multiple_choice';
      if (questionType.includes('true') || questionType.includes('false')) questionType = 'true_false';
      if (questionType.includes('short') || questionType.includes('answer')) questionType = 'short_answer';
      if (!['multiple_choice', 'true_false', 'short_answer'].includes(questionType)) {
        questionType = 'multiple_choice';
      }
      
      let correctAnswer = q.correctAnswer || q.answer || q.correct || q.solution || "";
      if (!correctAnswer && questionType === 'multiple_choice') {
        const options = [q.optionA, q.optionB, q.optionC, q.optionD].filter(Boolean);
        if (options.length > 0) {
          correctAnswer = options[0];
        }
      }
      
      return {
        questionText: q.questionText || q.question || "",
        questionType: questionType,
        optionA: q.optionA || null,
        optionB: q.optionB || null,
        optionC: q.optionC || null,
        optionD: q.optionD || null,
        correctAnswer: correctAnswer,
        rationale: q.rationale || null,
        points: q.points || 1,
        orderIndex: index,
        domain: domainName
      };
    });

    // Filter valid questions
    const validQuestions = normalizedQuestions.filter((q: any) => 
      q.questionText && q.correctAnswer && questionTypes.includes(q.questionType)
    );

    console.log(`🔍 Domain ${domainName}: Generated ${questions.length} → Normalized ${normalizedQuestions.length} → Valid ${validQuestions.length}`);
    
    return validQuestions;
    
  } catch (error: any) {
    console.error(`Error generating domain-specific questions for ${domainName}:`, error?.message || error);
    // If upstream gateway timeout, rethrow so caller can perform retries/backoff
    if (error?.isUpstream504 || (error?.message && error.message.includes('Upstream model gateway timeout'))) {
      throw error;
    }
    return [];
  }
}
