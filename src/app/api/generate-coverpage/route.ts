import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { auth } from "@/lib/auth";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    // Skip authentication for cover page generation as it's an internal API
    // The calling route (export-pdf) already handles authentication
    console.log('Cover page generation started');
    console.log('Headers:', Object.fromEntries(request.headers.entries()));

    const body = await request.json();
    const { exam_title, exam_subtitle, core_testing_areas, question_count, question_types, includes_answers, strict_mode } = body;

    // Validate input
    if (!exam_title) {
      return NextResponse.json(
        { error: "Missing required field: exam_title" },
        { status: 400 }
      );
    }

    // Build the AI prompt for cover page generation
    const prompt = `You are an expert educational content designer specializing in creating professional, official-style exam cover pages. Generate a comprehensive, professional cover page for the provided exam information.

${strict_mode ? 'STRICT MODE ENABLED: Follow ALL restrictions precisely. Any deviation will result in rejection.' : ''}

INPUT DATA:
- Exam Title: ${exam_title}
${exam_subtitle ? `- Exam Subtitle: ${exam_subtitle}` : ''}
${core_testing_areas && core_testing_areas.length > 0 ? `- Core Testing Areas: ${core_testing_areas.join(', ')}` : ''}
${question_count ? `- Total Questions: ${question_count}` : ''}
${question_types && question_types.length > 0 ? `- Question Types: ${question_types.join(', ')}` : ''}
${includes_answers !== undefined ? `- Includes Answer Key: ${includes_answers ? 'Yes' : 'No'}` : ''}

INSTRUCTIONS:
Generate a professional, official-style exam cover page using the information provided. The cover page must read like a real, formal exam packet—not a study guide.

TITLE GENERATION REQUIREMENTS:
- Create an eye-catching, customer-appealing title in this EXACT format:
  "[SUBJECT] UPDATED FINAL EXAM | ${new Date().getFullYear()}/${new Date().getFullYear() + 1} | Questions With Complete Solutions Graded A+ | [Full Subject Name] | [Certification/Institution Name]"
- Example: "AHA PALS UPDATED FINAL EXAM | 2025/2026 | Questions With Complete Solutions Graded A+ | Pediatric Advanced Life Support | American Heart Association Certification"
- Use pipe separators (|) between sections
- Include current academic year (${new Date().getFullYear()}/${new Date().getFullYear() + 1})
- Always include "Questions With Complete Solutions Graded A+"
- Make it appealing to customers seeking exam materials

OUTPUT REQUIREMENTS:
- Write a professional exam overview that describes the purpose and type of knowledge/competency being assessed
- Generate exam features as bullet points based on ACTUAL question content and types provided
- List EXACTLY the provided core testing areas as official exam sections (LIMIT: 7 areas maximum)
- Do NOT add sub-bullets or additional details under each core area
- Use professional, academic tone throughout
- Avoid mentioning AI generation, computer-based features, or automated systems
- Focus on the actual content and assessment format based on the provided data
- Features should reflect the real question types and format (${question_types?.join(', ') || 'assessment questions'})

STYLE GUIDELINES:
- Use official, authoritative language similar to standardized exams (ATI, NCLEX, etc.)
- Include current year (${new Date().getFullYear()}) and updated standards terminology  
- Emphasize evidence-based practice and professional competency assessment
- Base exam features STRICTLY on actual content: ${question_count || 'Multiple'} ${question_types?.join(', ') || 'Multiple Choice'} questions only
- FORBIDDEN: Never mention drag-and-drop, computer-based, automated scoring, SATA items, or digital features
- REQUIRED: Paper-based traditional examination format only
- FOCUS: Written assessment with ${includes_answers ? 'answer key and rationales' : 'professional evaluation format'}

EXAM FEATURES TEMPLATE - Use ONLY these types of features:
✓ [Number] Professional ${question_types?.join(', ') || 'Multiple Choice'} Questions  
✓ Realistic Professional Scenarios and Case Studies
✓ Evidence-Based Practice Standards and Guidelines
✓ Current ${new Date().getFullYear()} Professional Practice Requirements
✓ ${includes_answers ? 'Comprehensive Answer Key with Detailed Rationales' : 'Professional Assessment Format'}
✓ Covers [X] Major ${exam_title.includes('Medical') || exam_title.includes('Nursing') ? 'Clinical' : 'Professional'} Domains

CRITICAL: Return ONLY a valid JSON object in this exact format:
{
  "cover_page": {
    "title": "Eye-catching title following the format: [SUBJECT] UPDATED FINAL EXAM | ${new Date().getFullYear()}/${new Date().getFullYear() + 1} | Questions With Complete Solutions Graded A+ | [Full Subject Name] | [Certification Name]",
    "subtitle": "Professional subtitle with year/standards", 
    "exam_overview": "Comprehensive description of exam purpose and assessment focus",
    "exam_features": [
      "✓ Feature based on template above",
      "✓ Feature based on template above", 
      "✓ Feature based on template above",
      "✓ Feature based on template above",
      "✓ Feature based on template above",
      "✓ Feature based on template above"
    ],
    "exam_sections": ${JSON.stringify(core_testing_areas || [])}
  }
}

Generate content that matches the professionalism and structure of the ATI RN ADULT MEDICAL–SURGICAL example provided, but tailored to the specific exam title and core areas given.`;

    // Call Groq API for cover page generation
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are an expert educational assessment designer with 20+ years of experience creating professional exam materials for healthcare, educational institutions, and certification bodies. You specialize in creating official-style examination packets that mirror real standardized assessments. CRITICAL: You must ONLY respond with valid JSON - no markdown, no explanations, no text before or after the JSON object."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "openai/gpt-oss-20b", // Use the default model
      temperature: 0.3, // Lower temperature for more consistent, professional output
      max_tokens: 2000,
    });

    const responseText = completion.choices[0]?.message?.content || "";
    console.log("Raw cover page AI response:", responseText);

    // Parse the JSON response
    let coverPageData;
    try {
      // Remove markdown code blocks if present
      let jsonText = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      // Parse the JSON
      coverPageData = JSON.parse(jsonText);

      // Validate the structure
      if (!coverPageData.cover_page) {
        throw new Error("Invalid cover page structure - missing 'cover_page' object");
      }

      const { title, subtitle, exam_overview, exam_features, exam_sections } = coverPageData.cover_page;
      
      if (!title || !exam_overview || !exam_features || !Array.isArray(exam_features) || !exam_sections) {
        throw new Error("Missing required cover page fields");
      }

      // Validate content doesn't contain forbidden terms
      const forbiddenTerms = ['drag-and-drop', 'computer-based', 'automated', 'digital', 'SATA', 'select-all-that-apply'];
      const allText = JSON.stringify(coverPageData.cover_page).toLowerCase();
      
      for (const term of forbiddenTerms) {
        if (allText.includes(term.toLowerCase())) {
          throw new Error(`Generated content contains forbidden term: ${term}`);
        }
      }

      // Limit exam_sections to 7 items max
      if (Array.isArray(coverPageData.cover_page.exam_sections) && coverPageData.cover_page.exam_sections.length > 7) {
        coverPageData.cover_page.exam_sections = coverPageData.cover_page.exam_sections.slice(0, 7);
      }

    } catch (parseError) {
      console.error("Failed to parse cover page response:", parseError);
      console.error("Raw response:", responseText);
      
      return NextResponse.json(
        {
          error: "Failed to generate valid cover page format",
          details: parseError instanceof Error ? parseError.message : "Unknown parsing error",
          suggestion: "Try regenerating the cover page or check the input format."
        },
        { status: 500 }
      );
    }

    console.log("Generated cover page data:", coverPageData);

    return NextResponse.json({
      success: true,
      cover_page: coverPageData.cover_page,
      metadata: {
        exam_title,
        exam_subtitle,
        core_areas_count: core_testing_areas.length,
        generated_at: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error("Error generating cover page:", error);
    return NextResponse.json(
      { 
        error: "Failed to generate cover page", 
        details: error.message 
      },
      { status: 500 }
    );
  }
}