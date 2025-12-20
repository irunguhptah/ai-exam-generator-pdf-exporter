import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { buildExamHeading, parseExamTitle, type ExamHeadingOptions } from "@/lib/exam-heading-builder";
import Groq from "groq-sdk";
import { db } from "@/db";
import { exams } from "@/db/schema";
import { eq } from "drizzle-orm";

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Sanitize Unicode characters that cause PDF generation issues
function sanitizeUnicode(text: string): string {
  if (!text) return text;
  return text
    .replace(/[\u2013\u2014]/g, '-') // Replace em-dash and en-dash with regular dash
    .replace(/[\u2018\u2019]/g, "'") // Replace smart quotes with regular quotes
    .replace(/[\u201C\u201D]/g, '"') // Replace smart double quotes
    .replace(/[\u2026]/g, '...') // Replace ellipsis
    .replace(/[\u00A0]/g, ' ') // Replace non-breaking space
    .replace(/[\u2022]/g, '•') // Keep bullet points but ensure they're safe
    .replace(/[\u2713]/g, '✓'); // Keep checkmarks but ensure they're safe
}

// Process subtitle to add colored spans for year and grade
function processSubtitleWithColors(subtitle: string): string {
  return subtitle
    .replace(/([\d]{4}\/[\d]{4})/g, '<span class="year">$1</span>') // Match year format like 2025/2026
    .replace(/(A\+)/g, '<span class="grade">$1</span>'); // Match A+ grade
}

// Select the most appropriate subtitle from predefined options
function selectExamSubtitle(year: string, questionCount: number, title?: string, subject?: string): string {
  const subtitleOptions = [
    "Real {YEAR} Exam | {QCOUNT} Authentic Questions | 100% Verified Answers | A+ Quality",
    "{YEAR} Official-Level Exam Resource | {QCOUNT} Real Testing Items | Expert-Verified Solutions | A+ Rated",
    "Latest {YEAR} Edition • {QCOUNT} Real Exam Questions • Fully Verified A+ Answers",
    "{YEAR} True Exam Version | {QCOUNT} Actual Questions | Verified, Correct Answer Key | A+ Standard",
    "{QCOUNT} High-Accuracy Questions | {YEAR} Real Exam Format | Professionally Verified | A+ Quality",
    "{YEAR} Premium Exam Set | {QCOUNT} Genuine Items | Expert-Approved Answers | A+ Excellence",
    "Authentic {YEAR} Exam Blueprint | {QCOUNT} Real Questions | Verified Solutions | A+ Level",
    "{YEAR} Elite Study Resource | {QCOUNT} Exam-Style Questions | Accuracy-Verified | A+ Tier",
    "{YEAR} Real Exam Master Edition | {QCOUNT} Critical Questions | Verified A+ Answers",
    "{YEAR} Professional Exam Pack | {QCOUNT} Actual Exam Items | Certified Correct | A+ Quality",
    "{YEAR} High-Yield Exam Guide | {QCOUNT} Real Questions | Verified for Accuracy | A+ Status",
    "Exam-Exact {YEAR} Version | {QCOUNT} Realistic Questions | Verified Solutions | A+ Ready",
    "{YEAR} Real Assessment Q&A | {QCOUNT} Items | Verified Expert Answers | A+ Study Choice",
    "Genuine {YEAR} Exam Collection | {QCOUNT} Real Questions | Accuracy-Checked Answers | A+ Guaranteed",
    "{YEAR} High-Performance Exam Edition | {QCOUNT} Real Items | Verified Precision | A+ Rating",
    "{YEAR} Faculty-Level Validation | {QCOUNT} True Exam Questions | Verified Explanations | A+ Level Content",
    "Most Accurate {YEAR} Exam Set | {QCOUNT} Real Q&A | Expert-Verified | A+ Authority",
    "{YEAR} Authentic Testing Material | {QCOUNT} Questions | Verified Correct Responses | A+ Quality",
    "Fully Updated {YEAR} Version | {QCOUNT} Real Exam Questions | Verified Results | A+ Standard",
    "{YEAR} Real Exam Framework | {QCOUNT} Tested Items | Verified Answer Key | A+ Study Standard"
  ];

  // Logic to select the most appropriate subtitle based on context
  let selectedIndex = 0;

  // Healthcare/Medical exams - prefer more professional language
  const isHealthcare = (title?.toLowerCase().includes('nursing') || 
                       title?.toLowerCase().includes('medical') || 
                       title?.toLowerCase().includes('healthcare') ||
                       subject?.toLowerCase().includes('nursing') || 
                       subject?.toLowerCase().includes('medical') || 
                       subject?.toLowerCase().includes('healthcare'));

  if (isHealthcare) {
    // Prefer professional, clinical-sounding subtitles for healthcare
    selectedIndex = Math.floor(Math.random() * 5) + 15; // Options 16-20 are more professional
  }
  
  // Leadership/Management exams
  const isLeadership = (title?.toLowerCase().includes('leadership') || 
                       title?.toLowerCase().includes('management') ||
                       subject?.toLowerCase().includes('leadership') || 
                       subject?.toLowerCase().includes('management'));

  if (isLeadership) {
    // Use professional, authority-focused subtitles
    const professionalOptions = [5, 9, 15, 16, 19]; // Professional/Master/Authority options
    selectedIndex = professionalOptions[Math.floor(Math.random() * professionalOptions.length)];
  }

  // Anatomy/Science exams
  const isScience = (title?.toLowerCase().includes('anatomy') || 
                    title?.toLowerCase().includes('physiology') || 
                    title?.toLowerCase().includes('biology') ||
                    subject?.toLowerCase().includes('anatomy') || 
                    subject?.toLowerCase().includes('physiology') || 
                    subject?.toLowerCase().includes('biology'));

  if (isScience) {
    // Use technical, precise language
    const technicalOptions = [1, 6, 10, 14, 16]; // Technical/blueprint/precision options
    selectedIndex = technicalOptions[Math.floor(Math.random() * technicalOptions.length)];
  }

  // ATI/Proctored exams - use official-sounding subtitles
  const isATI = (title?.toLowerCase().includes('ati') || 
                title?.toLowerCase().includes('proctored') ||
                subject?.toLowerCase().includes('ati') || 
                subject?.toLowerCase().includes('proctored'));

  if (isATI) {
    const officialOptions = [1, 3, 8, 11, 19]; // Official/True/Exam-exact options
    selectedIndex = officialOptions[Math.floor(Math.random() * officialOptions.length)];
  }

  // If none of the above, use a general good option
  if (!isHealthcare && !isLeadership && !isScience && !isATI) {
    const generalOptions = [0, 2, 4, 7, 12]; // Generally good options
    selectedIndex = generalOptions[Math.floor(Math.random() * generalOptions.length)];
  }

  // Replace placeholders with actual values and add colored spans
  const processedSubtitle = subtitleOptions[selectedIndex]
    .replace(/{YEAR}/g, year)
    .replace(/{QCOUNT}/g, questionCount.toString());
  
  return processSubtitleWithColors(processedSubtitle);
}

// Extract main core testing points from various input formats
function extractMainCoreTestingPoints(input: string): string[] {
  const cleanedInput = input.trim();
  
  // Pattern 0: Numbered main sections with sub-bullets (most specific)
  // Example: "1. **Leadership & Management Concepts**\n   * Delegation\n   * Prioritization"
  const numberedSectionRegex = /^\d+\.\s*\*\*([^*]+)\*\*/gm;
  const numberedMatches = Array.from(cleanedInput.matchAll(numberedSectionRegex));
  if (numberedMatches.length >= 2) {
    const mainHeaders = numberedMatches
      .map(match => match[1].trim())
      .filter(header => header && header.length > 2);
    
    if (mainHeaders.length > 0) {
      return mainHeaders.slice(0, 8);
    }
  }
  
  // Pattern 1: Structured sections with numbered/bulleted main headers
  // Example: "1. **Leadership & Management Concepts**\n   * Delegation\n   * Prioritization"
  const structuredSections = cleanedInput.split(/\n\s*\n/).filter((section: string) => section.trim());
  if (structuredSections.length > 1) {
    const mainPoints: string[] = [];
    
    for (const section of structuredSections) {
      const lines = section.split('\n').map(line => line.trim()).filter(line => line);
      if (lines.length > 0) {
        const firstLine = lines[0];
        
        // Check if the first line is a main header (has numbering or is not a sub-bullet)
        const isMainHeader = (
          /^\d+\./.test(firstLine) || // Numbered list
          /^[A-Z]/.test(firstLine) || // Starts with capital letter (not sub-bullet)
          !firstLine.startsWith('*') && !firstLine.startsWith('-') // Not a bullet point
        );
        
        if (isMainHeader) {
          // Take the first line as the main point (remove numbering, bullets, markdown)
          const mainLine = firstLine
            .replace(/^\d+\.\s*/, '') // Remove numbering
            .replace(/^[•\-\*]\s*/, '') // Remove bullets
            .replace(/^\*\*(.*?)\*\*/, '$1') // Remove markdown bold
            .replace(/^#+\s*/, '') // Remove markdown headers
            .trim();
          
          if (mainLine && mainLine.length > 2) {
            mainPoints.push(mainLine);
          }
        }
      }
    }
    
    if (mainPoints.length > 0) {
      return mainPoints.slice(0, 8);
    }
  }
  
  // Pattern 2: Paragraph format with comma-separated items
  // Example: "This exam focuses on leadership in nursing, interprofessional communication, ethical and legal practice"
  if (!cleanedInput.includes('\n') || cleanedInput.split('\n').length <= 2) {
    const commaItems = cleanedInput
      .replace(/^.*?(focuses on|covers|includes|testing areas?:?)\s*/i, '') // Remove intro text
      .replace(/\.$/, '') // Remove trailing period
      .split(/,\s*and\s+|,\s*|\s+and\s+/) // Split by comma or "and"
      .map(item => item.trim())
      .filter(item => item && item.length > 3)
      .map(item => {
        // Clean up each item
        return item
          .replace(/^(the\s+)?/i, '') // Remove "the"
          .replace(/\s+(skills?|concepts?|practices?|management)$/i, ' $1') // Keep important endings
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      });
    
    if (commaItems.length >= 2) {
      return commaItems.slice(0, 8);
    }
  }
  
  // Pattern 3: Simple bullet list format
  // Example: "- Delegation, prioritization and supervision skills\n- Patient rights and advocacy"
  if (cleanedInput.includes('\n')) {
    const bulletItems = cleanedInput
      .split('\n')
      .map(line => line.trim())
      .filter(line => line)
      .map(line => {
        // Remove bullets and clean
        return line
          .replace(/^[•\-\*\+]\s*/, '')
          .replace(/^\d+\.\s*/, '')
          .trim();
      })
      .filter(item => item && item.length > 3);
    
    // Check if these look like main points (not too detailed)
    const mainBulletPoints = bulletItems.filter(item => {
      // Skip if it looks like sub-details (contains specific terms)
      const skipTerms = ['sbar', 'float staff', 'incident reporting', 'root cause'];
      const hasSkipTerms = skipTerms.some(term => item.toLowerCase().includes(term));
      
      // Keep if it's reasonably short and doesn't have skip terms
      return item.length <= 80 && !hasSkipTerms;
    });
    
    if (mainBulletPoints.length > 0) {
      return mainBulletPoints.slice(0, 8);
    }
  }
  
  // Pattern 4: Extract from longer text using key phrases
  const keyPhrases = [
    /leadership\s+(?:and\s+)?management/i,
    /interprofessional\s+communication/i,
    /teamwork/i,
    /ethical\s+(?:and\s+)?legal/i,
    /quality\s+(?:and\s+)?safety/i,
    /patient\s+(?:rights|advocacy|care)/i,
    /delegation/i,
    /prioritization/i,
    /supervision/i,
    /staffing/i,
    /resource\s+management/i,
    /clinical\s+(?:decision|judgment)/i,
    /assessment\s+skills/i,
    /documentation/i,
    /communication/i,
    /professionalism/i
  ];
  
  const extractedPhrases: string[] = [];
  for (const phrase of keyPhrases) {
    const match = cleanedInput.match(phrase);
    if (match) {
      const cleanedPhrase = match[0]
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      
      if (!extractedPhrases.some(existing => existing.toLowerCase() === cleanedPhrase.toLowerCase())) {
        extractedPhrases.push(cleanedPhrase);
      }
    }
  }
  
  if (extractedPhrases.length > 0) {
    return extractedPhrases.slice(0, 8);
  }
  
  // Fallback: Return first few sentences/phrases
  const fallbackItems = cleanedInput
    .split(/[,.;]/)
    .map(item => item.trim())
    .filter(item => item && item.length > 5 && item.length < 60)
    .slice(0, 5);
  
  return fallbackItems.length > 0 ? fallbackItems : ['Professional Practice Areas'];
}

// Generate complete HTML document with auto-print functionality
function generateCompleteHTML(coverPageContent: any, contentHtml: string, processedCoreAreas: string[], examTitle: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${examTitle} - ${coverPageContent.subtitle.replace(/<[^>]*>/g, '')}</title>
    <style>
        /* PROFESSIONAL ACADEMIC EXAM STYLING */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Source+Serif+Pro:wght@400;600;700&display=swap');
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        :root {
            --primary-navy: #0A1A2F;
            --charcoal-navy: #1C2A3A;
            --accent-grey: #C2C7D0;
            --body-bg: #F8F8F8;
            --white: #FFFFFF;
            --text-dark: #2C3E50;
            --text-medium: #5A6C7D;
            --font-heading: 'Source Serif Pro', 'Times New Roman', serif;
            --font-body: 'Inter', 'Helvetica Neue', Arial, sans-serif;
        }
        
        body {
            font-family: var(--font-body);
            padding: 0;
            margin: 0;
            line-height: 1.6;
            background-color: var(--body-bg);
            color: var(--text-dark);
            width: 100%;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        /* Cover page styles */
        .header {
            background: var(--primary-navy);
            color: var(--white);
            padding: 30px 40px;
            min-height: 100vh;
            width: 100%;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .main-exam-title {
            font-family: var(--font-heading);
            font-size: 1.8rem;
            font-weight: 700;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 2px solid rgba(255,255,255,0.3);
            letter-spacing: -0.02em;
            color: var(--white);
            text-align: center;
            line-height: 1.2;
            max-width: 900px;
        }

        .exam-subheading {
            font-family: var(--font-body);
            font-size: 0.95rem;
            font-weight: 600;
            color: rgba(255,255,255,0.95);
            text-align: center;
            line-height: 1.4;
            margin-bottom: 24px;
            max-width: 700px;
        }
        
        .exam-subheading .year {
            color: #FFD700;
            font-weight: 700;
        }
        
        .exam-subheading .grade {
            color: #90EE90;
            font-weight: 700;
        }

        .exam-overview-section {
            background: white;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 12px;
            margin: 8px 0;
            width: 100%;
            max-width: 800px;
        }
        
        .instructions-box, .exam-sections-box {
            background: white;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 12px;
            margin: 8px 0;
            width: 100%;
            max-width: 800px;
        }

        .exam-overview-section h3 {
            font-family: var(--font-heading);
            font-size: 0.95rem;
            font-weight: 600;
            color: black;
            margin-bottom: 6px;
            text-align: left;
            border-bottom: 2px solid #ccc;
            padding-bottom: 3px;
        }
        
        .instructions-box h3, .exam-sections-box h3 {
            font-family: var(--font-heading);
            font-size: 0.95rem;
            font-weight: 600;
            color: black;
            margin-bottom: 6px;
            text-align: left;
            border-bottom: 2px solid #ccc;
            padding-bottom: 3px;
        }

        .exam-overview-text {
            font-size: 0.9rem;
            line-height: 1.5;
            color: black;
            margin: 0;
            text-align: left;
        }

        .instructions-list, .sections-list {
            margin: 0;
            padding-left: 0;
            list-style: none;
            text-align: left;
        }

        .instructions-list li {
            margin-bottom: 6px;
            font-size: 0.85rem;
            line-height: 1.3;
            color: black;
            position: relative;
            padding-left: 18px;
            text-align: left;
        }
        
        .instructions-list li::before {
            content: '•';
            color: black;
            font-weight: bold;
            position: absolute;
            left: 0;
            top: 0;
        }

        .sections-list li {
            margin-bottom: 6px;
            font-size: 0.85rem;
            line-height: 1.4;
            color: black;
            position: relative;
            padding-left: 18px;
        }
        
        .sections-list li::before {
            content: '→';
            color: black;
            position: absolute;
            left: 0;
            top: 0;
        }

        /* Question content styles */
        .content-container {
            width: 100%;
            margin: 0 auto;
            padding: 30px 50px;
            background-color: var(--body-bg);
        }

        .question {
            background: var(--white);
            border: 1px solid var(--accent-grey);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            page-break-inside: auto;
            break-inside: auto;
        }

        .question-number {
            font-family: var(--font-heading);
            color: var(--primary-navy);
            font-weight: 700;
            font-size: 0.95rem;
            margin-bottom: 8px;
            padding-bottom: 4px;
            border-bottom: 2px solid var(--accent-grey);
        }

        .category-header {
            margin-top: 25px;
            margin-bottom: 15px;
            padding: 8px 0;
            border-bottom: 2px solid var(--primary-navy);
            page-break-inside: avoid;
            break-inside: avoid;
        }

        .category-title {
            font-family: var(--font-heading);
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--primary-navy);
            margin: 0;
        }

        .category-spacer {
            height: 20px;
            page-break-after: auto;
        }

        .question-text {
            font-family: var(--font-body);
            margin: 8px 0 10px 0;
            font-size: 0.9rem;
            line-height: 1.5;
            color: var(--text-dark);
            font-weight: 500;
        }

        .answer-options {
            margin: 10px 0 8px 0;
            background: #FAFBFC;
            border: 1px solid #E8EAED;
            border-radius: 6px;
            padding: 8px 12px;
        }

        .option {
            margin: 4px 0;
            font-size: 0.85rem;
            line-height: 1.4;
            padding: 3px 0;
            color: var(--text-medium);
            font-style: italic;
            text-indent: -2em;
            padding-left: 2em;
        }

        .answer-title {
            font-family: var(--font-heading);
            color: var(--charcoal-navy);
            font-weight: 600;
            margin: 8px 0 6px 0;
            font-size: 0.9rem;
        }

        .answer-content {
            margin: 6px 0 8px 0;
            padding: 8px 12px;
            background: #F8F9FA;
            border-left: 4px solid var(--charcoal-navy);
            border-radius: 0 4px 4px 0;
            color: var(--text-dark);
            font-size: 0.85rem;
            line-height: 1.4;
        }

        .correct-answer {
            color: #2E7D32;
            background-color: rgba(46, 125, 50, 0.1);
            font-weight: 600;
            padding: 8px 12px;
            border-radius: 6px;
            border-left: 4px solid #2E7D32;
            margin: 6px 0 8px 0;
            font-size: 0.85rem;
            line-height: 1.4;
        }

        .rationale {
            background-color: #F5F7FA;
            padding: 8px 12px;
            border-radius: 6px;
            margin: 6px 0;
            border-left: 4px solid var(--accent-grey);
            font-size: 0.8rem;
            line-height: 1.4;
            color: var(--text-medium);
        }
        
        .rationale strong {
            color: var(--charcoal-navy);
            font-family: var(--font-heading);
            font-weight: 600;
        }

        hr {
            border: 0;
            height: 1px;
            background: linear-gradient(to right, transparent, var(--accent-grey), transparent);
            margin: 8px 0;
        }

        /* Print styles */
        @media print {
            @page {
                size: A4;
                margin: 0.5in;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
                
                @bottom-right {
                    content: "Page " counter(page);
                    font-size: 10pt;
                    color: #666;
                    font-family: var(--font-body);
                }
            }

            * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }

            .header {
                background: var(--primary-navy) !important;
                color: var(--white) !important;
                page-break-after: always;
            }

            .question {
                page-break-inside: avoid;
                break-inside: avoid;
            }

            .content-container {
                padding: 20px !important;
            }
        }
    </style>
    <script>
        // Auto-trigger print dialog when page loads
        window.addEventListener('load', function() {
            // Small delay to ensure full rendering
            setTimeout(function() {
                window.print();
            }, 500);
        });
    </script>
</head>
<body>
    <!-- Cover Page -->
    <div class="header">
        <div class="main-exam-title">${coverPageContent.title}</div>
        <div class="exam-subheading">${coverPageContent.subtitle}</div>
        
        <div class="exam-overview-section">
            <h3>EXAM OVERVIEW</h3>
            <p class="exam-overview-text">${coverPageContent.exam_overview}</p>
        </div>
        
        <div class="instructions-box">
            <h3>EXAM FEATURES</h3>
            <ul class="instructions-list">
                ${coverPageContent.exam_features.map((feature: string) => `<li>${feature}</li>`).join('')}
            </ul>
        </div>
        
        ${processedCoreAreas && processedCoreAreas.length > 0 ? `
        <div class="exam-sections-box">
            <h3>CORE TESTING AREAS</h3>
            <ul class="sections-list">
                ${processedCoreAreas.map((section: string) => `<li>${section}</li>`).join('')}
            </ul>
        </div>
        ` : ''}
    </div>
    
    <!-- Questions Content -->
    <div class="content-container">
        ${contentHtml}
    </div>
</body>
</html>`;
}

// Parse structured answer content
function parseAnswerContent(answerContent: string) {
  const sections = {
    options: [] as string[],
    correctAnswer: "",
    rationale: "",
  };
  if (!answerContent) return sections;
  const lines = answerContent.split("\n");
  let currentSection = "";
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.includes("Answer Options:")) {
      currentSection = "options";
      continue;
    } else if (line.includes("Correct Answer:")) {
      currentSection = "correctAnswer";
      const answerMatch = line.match(/Correct Answer:\s*(.+)/);
      if (answerMatch) sections.correctAnswer = answerMatch[1].trim();
      continue;
    } else if (line.includes("Rationale:")) {
      currentSection = "rationale";
      const rationaleMatch = line.match(/Rationale:\s*(.+)/);
      if (rationaleMatch) sections.rationale = rationaleMatch[1].trim();
      continue;
    }
    if (currentSection === "options" && /^[A-D]\.\s/.test(line))
      sections.options.push(line);
    else if (currentSection === "correctAnswer" && line)
      sections.correctAnswer = line;
    else if (currentSection === "rationale" && line) {
      sections.rationale = sections.rationale
        ? sections.rationale + " " + line
        : line;
    }
  }
  return sections;
}

export async function POST(request: NextRequest) {
  try {
    const { examId, questions, examTitle, includeAnswers, subject, coreTestingAreas, academicYear, domainDistribution, domainBlueprints, scenarioFormat } = await request.json();
    
    console.log("PDF Export Request:", {
      examId: examId || "(no examId)",
      questionsCount: questions?.length || 0,
      examTitle: examTitle || "(no title)",
      subject: subject || "(no subject)",
      coreTestingAreas: coreTestingAreas || "(empty)",
      academicYear: academicYear || "(default current year)",
      domainDistribution: domainDistribution || "(not provided)"
    });

    // Try to fetch cached PDF metadata from database if examId is provided
    let cachedPdfMetadata = null;
    if (examId) {
      try {
        console.log(`📄 Fetching cached PDF metadata for exam ${examId}...`);
        const examData = await db
          .select({
            subtitle: exams.subtitle,
            examOverview: exams.examOverview,
            examFeatures: exams.examFeatures,
            coreTestingAreasFormatted: exams.coreTestingAreasFormatted,
            domainsMetadata: exams.domainsMetadata,
          })
          .from(exams)
          .where(eq(exams.id, examId))
          .limit(1);

        if (examData.length > 0 && examData[0].subtitle) {
          cachedPdfMetadata = examData[0];
          console.log(`✅ Found cached PDF metadata for exam ${examId}`);
        } else {
          console.log(`ℹ️ No cached PDF metadata found for exam ${examId}, will generate with AI`);
        }
      } catch (dbError) {
        console.warn("Failed to fetch cached PDF metadata:", dbError);
      }
    }
    
    // Debug: Check question structure and domain info
    if (questions && questions.length > 0) {
      console.log("🔍 Sample question structure:", {
        firstQuestion: questions[0],
        questionKeys: Object.keys(questions[0] || {}),
        hasDomain: !!questions[0]?.domain,
        domainValue: questions[0]?.domain
      });
    }

    if (!questions || questions.length === 0) {
      return NextResponse.json(
        { error: "No questions provided" },
        { status: 400 }
      );
    }

    // Filter out invalid questions first
    const validQuestions = questions.filter((q: any) => 
      q && (q.questionText || q.question) && typeof (q.questionText || q.question) === 'string'
    );

    if (validQuestions.length === 0) {
      return NextResponse.json(
        { error: "No valid questions found" },
        { status: 400 }
      );
    }

    console.log(`Processing ${validQuestions.length} valid questions out of ${questions.length} total`);

    // Transform the questions data to match the expected format
    const transformedData = validQuestions.map((question: any) => {
      let answerContent = "";

      // Build answer content based on question type
      if (
        question.questionType === "multiple_choice" ||
        question.questionType === "true_false"
      ) {
        const options = [
          { letter: "A", text: question.optionA },
          { letter: "B", text: question.optionB },
          { letter: "C", text: question.optionC },
          { letter: "D", text: question.optionD },
        ].filter((opt) => opt.text);

        answerContent = "Answer Options:\n";
        options.forEach((option) => {
          answerContent += `${option.letter}. ${option.text}\n`;
        });

        if (includeAnswers && question.correctAnswer) {
          answerContent += `\nCorrect Answer: ${question.correctAnswer}\n`;
        }

        if (includeAnswers && question.rationale) {
          answerContent += `\nRationale: ${question.rationale}`;
        }
      } else if (question.questionType === "short_answer") {
        if (includeAnswers && question.correctAnswer) {
          answerContent += `Correct Answer: ${question.correctAnswer}\n`;
        }

        if (includeAnswers && question.rationale) {
          answerContent += `\nRationale: ${question.rationale}`;
        }
      }

      return {
        question: sanitizeUnicode(question.questionText || question.question || ""),
        answer: sanitizeUnicode(answerContent),
        imageUrl: question.imageUrl || null,
      };
    });

    // Generate HTML content with category grouping if domain distribution is provided
    let contentHtml = "";
    
    if (domainDistribution && Object.keys(domainDistribution).length > 0) {
      // Group questions by categories with proper distribution
      const categoryGroups: {[key: string]: any[]} = {};
      const categories = Object.keys(domainDistribution);
      
      // Initialize category groups
      categories.forEach(category => {
        categoryGroups[category] = [];
      });
      
      // Distribute questions proportionally based on domain distribution
      let currentQuestionIndex = 0;
      
      categories.forEach(category => {
        const questionsForCategory = domainDistribution[category];
        for (let i = 0; i < questionsForCategory && currentQuestionIndex < transformedData.length; i++) {
          if (transformedData[currentQuestionIndex]) {
            categoryGroups[category].push({
              ...transformedData[currentQuestionIndex],
              globalIndex: currentQuestionIndex
            });
            currentQuestionIndex++;
          }
        }
      });
      
      // If there are remaining questions, distribute them to categories with space
      while (currentQuestionIndex < transformedData.length) {
        for (const category of categories) {
          if (currentQuestionIndex < transformedData.length) {
            categoryGroups[category].push({
              ...transformedData[currentQuestionIndex],
              globalIndex: currentQuestionIndex
            });
            currentQuestionIndex++;
          }
        }
      }
      
      // Generate HTML with category headers
      let globalQuestionNumber = 1;
      Object.entries(categoryGroups).forEach(([category, categoryQuestions], categoryIndex) => {
        if (categoryQuestions.length > 0) {
          // Add category header with question count
          contentHtml += `<div class="category-header">
            <h2 class="category-title">${category} (${categoryQuestions.length} Questions)</h2>
          </div>`;
          
          // Add questions for this category
          categoryQuestions.forEach((item: any, questionInCategoryIndex: number) => {
            const question = item.question || "";
            const answer = item.answer || "";
            const answerSections = parseAnswerContent(answer);

            // Add question wrapper for better page control
            contentHtml += `<div class="question" data-question="${globalQuestionNumber}" data-category="${category}">`;
            contentHtml += `<div class="question-number">Question ${globalQuestionNumber}</div>`;
            contentHtml += `<div class="question-text">${question.replace(
              /\n/g,
              "<br>"
            )}</div>`;

            if (item.imageUrl) {
              contentHtml += `<div class="question-image"><img src="${item.imageUrl}" onerror="this.style.display='none'"></div>`;
            }

            if (answerSections.options && answerSections.options.length > 0) {
              contentHtml += `<div class="answer-options">`;
              answerSections.options.forEach((option) => {
                contentHtml += `<div class="option">&nbsp;&nbsp;&nbsp;&nbsp;${option}</div>`;
              });
              contentHtml += `</div>`;
            }

            if (includeAnswers && answerSections.correctAnswer) {
              // Handle optionA/B/C/D format by finding the full text
              let fullAnswerText = answerSections.correctAnswer;
              
              // Check if it's in optionA/B/C/D format
              const optionMatch = answerSections.correctAnswer.match(/^option([A-D])$/i);
              if (optionMatch) {
                const optionLetter = optionMatch[1].toUpperCase();
                const matchingOption = answerSections.options.find(opt => opt.startsWith(optionLetter + '.'));
                if (matchingOption) {
                  fullAnswerText = matchingOption;
                }
              }
              
              contentHtml += `<div class="answer-title">Correct Answer</div>`;
              contentHtml += `<div class="answer-content correct-answer">${fullAnswerText}</div>`;
            }

            if (
              includeAnswers &&
              answerSections.rationale &&
              !answerSections.rationale.startsWith("Error:")
            ) {
              contentHtml += `<div class="rationale"><strong>Rationale:</strong><br><em style="font-size: 0.9em; color: #374151;">${answerSections.rationale.replace(
                /\n/g,
                "<br>"
              )}</em></div>`;
            }

            contentHtml += `</div>`;
            
            // Add separator only between questions (not after the last one in the last category)
            const isLastQuestionInLastCategory = categoryIndex === Object.keys(categoryGroups).length - 1 && 
                                                  questionInCategoryIndex === categoryQuestions.length - 1;
            
            if (!isLastQuestionInLastCategory) {
              contentHtml += `<hr class="question-separator">`;
            }
            
            globalQuestionNumber++;
          });
          
          // Add space after category (except for the last category)
          if (categoryIndex < Object.keys(categoryGroups).length - 1) {
            contentHtml += `<div class="category-spacer"></div>`;
          }
        }
      });
    } else {
      // Original logic without categories
      transformedData.forEach((item: any, index: number) => {
        const question = item.question || "";
        const answer = item.answer || "";
        const answerSections = parseAnswerContent(answer);

        // Add question wrapper for better page control
        contentHtml += `<div class="question" data-question="${index + 1}">`;
        contentHtml += `<div class="question-number">Question ${index + 1}</div>`;
        contentHtml += `<div class="question-text">${question.replace(
          /\n/g,
          "<br>"
        )}</div>`;

        if (item.imageUrl) {
          contentHtml += `<div class="question-image"><img src="${item.imageUrl}" onerror="this.style.display='none'"></div>`;
        }

        if (answerSections.options && answerSections.options.length > 0) {
          contentHtml += `<div class="answer-options">`;
          answerSections.options.forEach((option) => {
            contentHtml += `<div class="option">&nbsp;&nbsp;&nbsp;&nbsp;${option}</div>`;
          });
          contentHtml += `</div>`;
        }

        if (includeAnswers && answerSections.correctAnswer) {
          // Handle optionA/B/C/D format by finding the full text
          let fullAnswerText = answerSections.correctAnswer;
          
          // Check if it's in optionA/B/C/D format
          const optionMatch = answerSections.correctAnswer.match(/^option([A-D])$/i);
          if (optionMatch) {
            const optionLetter = optionMatch[1].toUpperCase();
            const matchingOption = answerSections.options.find(opt => opt.startsWith(optionLetter + '.'));
            if (matchingOption) {
              fullAnswerText = matchingOption;
            }
          }
          
          contentHtml += `<div class="answer-title">Correct Answer</div>`;
          contentHtml += `<div class="answer-content correct-answer">${fullAnswerText}</div>`;
        }

        if (
          includeAnswers &&
          answerSections.rationale &&
          !answerSections.rationale.startsWith("Error:")
        ) {
          contentHtml += `<div class="rationale"><strong>Rationale:</strong><br><em style="font-size: 0.9em; color: #374151;">${answerSections.rationale.replace(
            /\n/g,
            "<br>"
          )}</em></div>`;
        }

        contentHtml += `</div>`;
        
        // Add separator only between questions (not after the last one)
        if (index < transformedData.length - 1) {
          contentHtml += `<hr class="question-separator">`;
        }
      });
    }

    // Calculate values for the template
    const totalQuestions = transformedData.length;
    const examTime = Math.ceil(totalQuestions * 2);
    const currentYear = new Date().getFullYear();
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Analyze the actual questions to generate accurate cover page
    const questionTypes = new Set<string>();
    const questionTypeMapping: Record<string, string> = {
      'multiple_choice': 'Multiple Choice',
      'true_false': 'True/False',
      'short_answer': 'Short Answer'
    };

    transformedData.forEach((item: any) => {
      // Find the question type from the original questions data
      const originalQuestion = questions.find((q: any) => q.questionText === item.question);
      if (originalQuestion && originalQuestion.questionType) {
        questionTypes.add(questionTypeMapping[originalQuestion.questionType] || originalQuestion.questionType);
      }
    });

    // Domain calculations and features will be generated later

    // Parse exam title for better information extraction
    const parsedInfo = parseExamTitle(examTitle || "Professional Examination");
    
    // Use exact title as provided by user and selected academic year
    const optimizedTitle = examTitle || subject || 'Professional Examination';
    const selectedYear = academicYear || `${currentYear}/${currentYear + 1}`;
    
    // Select most appropriate subtitle from predefined options
    const optimizedSubheading = selectExamSubtitle(selectedYear, totalQuestions, optimizedTitle, subject);
    
    // Generate professional exam overview
    const isHealthcareExam = subject ? (
      subject.toLowerCase().includes("nursing") ||
      subject.toLowerCase().includes("medical") ||
      subject.toLowerCase().includes("healthcare") ||
      subject.toLowerCase().includes("medicine") ||
      subject.toLowerCase().includes("anatomy") ||
      subject.toLowerCase().includes("physiology")
    ) : false;
    
    const examName = examTitle || subject || 'Professional Examination';
    const yearDisplay = academicYear || `${currentYear}/${currentYear + 1}`;
    
    // Extract school/university info using AI for better accuracy
    const schoolInfo = subject ? await (async () => {
      try {
        const extractionPrompt = `Extract the university, college, or school name from this text. Return ONLY the institution name, nothing else. If no institution is found, return "none".

Text: "${subject}"

Examples:
"Western Governors University D236 Objective Assessment" → "Western Governors University"
"Harvard Medical School MCAT Prep" → "Harvard Medical School"  
"MIT 6.034 Artificial Intelligence" → "MIT"
"University of California Berkeley CS101" → "University of California Berkeley"
"Johns Hopkins University School of Medicine" → "Johns Hopkins University School of Medicine"
"Stanford Computer Science Department" → "Stanford University"

Institution name:`;

        const response = await groq.chat.completions.create({
          messages: [{ role: "user", content: extractionPrompt }],
          model: "llama-3.1-8b-instant",
          temperature: 0.1,
          max_tokens: 50
        });

        const extracted = response.choices[0]?.message?.content?.trim();
        if (extracted && extracted.toLowerCase() !== 'none' && extracted.length > 2) {
          return extracted;
        }
        return null;
      } catch (error) {
        console.warn("AI university extraction failed, falling back to basic detection:", error);
        // Simple fallback for common patterns
        const simpleMatch = subject.match(/\b([\w\s]+(?:University|College|Institute|School))/i);
        return simpleMatch ? simpleMatch[1].trim() : null;
      }
    })() : null;
    
    // Use domain distribution sent from dashboard (already calculated from QuestionTable)
    let actualDomainCounts: {[key: string]: number} = {};
    let actualDomainCount = 0;
    
    if (domainDistribution && Object.keys(domainDistribution).length > 0) {
      // Use the domain distribution calculated by dashboard (matches QuestionTable exactly)
      actualDomainCounts = domainDistribution;
      actualDomainCount = Object.keys(domainDistribution).length;
      console.log('✅ Using domain distribution from dashboard:', Object.entries(actualDomainCounts).map(([domain, count]) => `${domain} (${count} Questions)`).join(', '));
    } else {
      // Fallback: calculate from questions array
      console.log('⚠️ No domainDistribution provided, calculating from questions array...');
      questions.forEach((q: any, index: number) => {
        const domain = q.domain || 'General';
        actualDomainCounts[domain] = (actualDomainCounts[domain] || 0) + 1;
        
        // Debug: Log domain assignment for first few questions
        if (index < 5) {
          console.log(`🔍 Question ${index + 1}: domain="${q.domain}" -> counted as "${domain}"`);
        }
      });
      actualDomainCount = Object.keys(actualDomainCounts).length;
      console.log('📊 Calculated Domain Counts:', Object.entries(actualDomainCounts).map(([domain, count]) => `${domain} (${count} Questions)`).join(', '));
    }

    // Enhanced debugging for domain distribution
    console.log("🔍 DOMAIN DISTRIBUTION DEBUG:");
    console.log("- domainDistribution received:", domainDistribution);
    console.log("- domainDistribution type:", typeof domainDistribution);
    console.log("- domainDistribution keys:", domainDistribution ? Object.keys(domainDistribution) : "none");
    console.log("- actualDomainCounts calculated:", actualDomainCounts);
    console.log("- Which will be used:", domainDistribution && Object.keys(domainDistribution).length > 0 ? "domainDistribution" : "actualDomainCounts");

    // Generate processed core areas using domainDistribution (final post-deduplication counts from dashboard)
    const processedCoreAreas: string[] = domainDistribution && Object.keys(domainDistribution).length > 0
      ? Object.entries(domainDistribution)
          .map(([domain, count]) => `${domain} (${count} Questions)`) // Match exact format: "Cardiovascular & Hematologic (15 Questions)"
          .sort() // Sort alphabetically for consistency
      : Object.entries(actualDomainCounts)
          .map(([domain, count]) => `${domain} (${count} Questions)`)
          .sort();
    
    console.log("✅ Final processed core areas:", processedCoreAreas);

    // Generate features based on actual content
    const examFeatures = [
      `✓ ${totalQuestions} Comprehensive ${Array.from(questionTypes).join(', ')} Questions`,
      includeAnswers ? "✓ Verified Correct Answers with Detailed Rationales" : "✓ Professional Assessment Format",
      "✓ Evidence-Based Content Aligned with Current Standards",
      `✓ Covers ${actualDomainCount} Major ${subject || 'Subject'} Domains`,
      "✓ Realistic Clinical/Professional Scenarios",
      "✓ Critical Thinking and Application-Focused Items"
    ];

    // Generate AI-powered exam overview and features
    const { academicOverview, professionalFeatures } = await (async () => {
      try {
        const domainCount = actualDomainCount;
        
        // Use actual domain counts in AI prompts (matches what user sees in dashboard)
        const domainCountsText = Object.entries(actualDomainCounts)
          .map(([domain, count]) => `${domain} (${count} questions)`)
          .join(', ');
        const schoolText = schoolInfo ? `${schoolInfo} ` : '';
        
        const overviewPrompt = `Generate an EXAM OVERVIEW for "${examName}" with these requirements:

EXAM DATA:
- Title: ${examName}
- Questions: ${totalQuestions}
- Year: ${yearDisplay}
- School: ${schoolText}

REQUIREMENTS:
• Exactly ~50 words
• Must include the exam title "${examName}"
• Tone: high-value, professional, persuasive, student-attracting
• Emphasize authenticity, accuracy, verified answers, exam realism
• One paragraph only. No bullets.

EXAMPLE STYLE:
"The ${examName} delivers a realistic and fully verified ${yearDisplay} exam experience designed to strengthen mastery and test readiness. Featuring ${totalQuestions} carefully structured questions and professional-level accuracy, this resource enhances critical reasoning and supports confident performance, making it an essential tool for students seeking reliable, high-quality exam preparation."

Generate ONLY the overview paragraph (no labels, no extra text):`;

        const featuresPrompt = `Generate 5 EXAM FEATURES bullets for "${examName}":

EXAM DATA:
- Questions: ${totalQuestions}
- Domains: ${domainCount}
- Year: ${yearDisplay}

REQUIREMENTS:
• Exactly 5 bullet points
• Must include ${totalQuestions} questions and ${domainCount} domains
• Highlight verified accuracy, high-yield content, realism, confidence-building
• No repeated ideas or filler

EXAMPLE STYLE:
• ${totalQuestions} exam-accurate questions aligned with standards
• Coverage of ${domainCount} domains for complete preparation
• Verified answers with detailed explanations
• High-yield content for efficient study
• Builds confidence for exam success

Generate ONLY the 5 bullet points (include • symbols):`;

        const [overviewResponse, featuresResponse] = await Promise.all([
          groq.chat.completions.create({
            messages: [{ role: "user", content: overviewPrompt }],
            model: "llama-3.1-8b-instant",
            temperature: 0.3,
            max_tokens: 150
          }),
          groq.chat.completions.create({
            messages: [{ role: "user", content: featuresPrompt }],
            model: "llama-3.1-8b-instant", 
            temperature: 0.3,
            max_tokens: 200
          })
        ]);

        const aiOverview = overviewResponse.choices[0]?.message?.content?.trim() || '';
        const aiFeatures = featuresResponse.choices[0]?.message?.content?.trim() || '';
        
        // Parse features into array (split by bullet points and clean)
        const featuresArray = aiFeatures
          .split(/\n\s*•\s*/)
          .filter(f => f.trim())
          .map(f => f.replace(/^•\s*/, '').trim())
          .slice(0, 5); // Ensure exactly 5 features

        return {
          academicOverview: aiOverview,
          professionalFeatures: featuresArray.length === 5 ? featuresArray : [
            `${totalQuestions} exam-accurate questions aligned with real testing standards`,
            `Coverage of ${domainCount} domains ensuring complete subject representation`,
            'Verified answers crafted for clarity and reliability',
            'High-yield, exam-focused content optimized for fast mastery',
            'Designed to build confidence and improve exam-day performance'
          ]
        };

      } catch (error) {
        console.warn("AI overview/features generation failed, using fallback:", error);
        // Fallback to simplified versions
        return {
          academicOverview: `The ${examName} delivers a realistic and fully verified ${yearDisplay} exam experience designed to strengthen mastery and test readiness. Featuring ${totalQuestions} carefully structured questions and professional-level accuracy, this resource enhances critical reasoning and supports confident performance.`,
          professionalFeatures: [
            `${totalQuestions} exam-accurate questions aligned with standards`,
            'Comprehensive subject coverage for complete preparation',
            'Verified answers with detailed explanations',
            'High-yield content for efficient study',
            'Builds confidence for exam success'
          ]
        };
      }
    })();

    let coverPageContent = {
      title: sanitizeUnicode(optimizedTitle),
      subtitle: sanitizeUnicode(optimizedSubheading),
      exam_overview: sanitizeUnicode(academicOverview),
      exam_features: professionalFeatures.map(feature => sanitizeUnicode(feature)),
      exam_sections: processedCoreAreas.map(section => sanitizeUnicode(section))
    };

    // Use cached PDF metadata if available, otherwise use AI-generated content
    if (cachedPdfMetadata) {
      console.log("📄 Using cached PDF metadata instead of AI generation");
      
      try {
        // Parse JSON fields
        const cachedFeatures = cachedPdfMetadata.examFeatures ? JSON.parse(cachedPdfMetadata.examFeatures) : professionalFeatures;
        const cachedCoreAreas = cachedPdfMetadata.coreTestingAreasFormatted ? JSON.parse(cachedPdfMetadata.coreTestingAreasFormatted) : processedCoreAreas;
        
        coverPageContent = {
          title: sanitizeUnicode(optimizedTitle), // Always use optimized title
          subtitle: sanitizeUnicode(cachedPdfMetadata.subtitle || optimizedSubheading),
          exam_overview: sanitizeUnicode(cachedPdfMetadata.examOverview || academicOverview),
          exam_features: Array.isArray(cachedFeatures) ? cachedFeatures.map(feature => sanitizeUnicode(feature)) : professionalFeatures.map(feature => sanitizeUnicode(feature)),
          exam_sections: Array.isArray(cachedCoreAreas) ? cachedCoreAreas.map(section => sanitizeUnicode(section)) : processedCoreAreas.map(section => sanitizeUnicode(section))
        };
        
        console.log("✅ Successfully applied cached PDF metadata");
      } catch (parseError) {
        console.warn("Failed to parse cached PDF metadata, using AI-generated fallback:", parseError);
        // Fall back to AI-generated content
        coverPageContent = {
          title: sanitizeUnicode(optimizedTitle),
          subtitle: sanitizeUnicode(optimizedSubheading),
          exam_overview: sanitizeUnicode(academicOverview),
          exam_features: professionalFeatures.map(feature => sanitizeUnicode(feature)),
          exam_sections: processedCoreAreas.map(section => sanitizeUnicode(section))
        };
      }
    } else {
      console.log("📄 No cached PDF metadata available, using AI-generated content");
      // Always use our custom title and subtitle format, override any AI generation
      coverPageContent = {
        title: sanitizeUnicode(optimizedTitle),
        subtitle: sanitizeUnicode(optimizedSubheading),
        exam_overview: sanitizeUnicode(academicOverview),
        exam_features: professionalFeatures.map(feature => sanitizeUnicode(feature)),
        exam_sections: processedCoreAreas.map(section => sanitizeUnicode(section))
      };
    }
    // Generate a concise "Topics Covered" list using your Groq helper if available.
    // Expected helper signature: ` + "getExamTopicsFromGroq(questions: any[]) => Promise<string[]>" + `
    let topicsCovered: string[] = [];
    try {
      // Use a relative path so the module can be resolved at runtime from this file location.
      // route.ts is located at src/app/api/export-pdf/route.ts, so go up to src then into lib.
      const mod: any = await import('../../../lib/groq-utils').catch(() => null);
      if (mod && typeof mod.getExamTopicsFromGroq === 'function') {
        topicsCovered = await mod.getExamTopicsFromGroq(validQuestions || transformedData);
      }
    } catch (err) {
      console.warn('getExamTopicsFromGroq not available or failed, falling back to cover page sections', err);
    }

    if (!topicsCovered || !topicsCovered.length) {
      topicsCovered = (coverPageContent.exam_sections && coverPageContent.exam_sections.length)
        ? coverPageContent.exam_sections.slice(0, 8)
        : (processedCoreAreas || []).slice(0, 8);
    }

    // Provide subject-specific fallback if still empty
    if (!topicsCovered || !topicsCovered.length) {
      const isHealthcare = (subject || '').toLowerCase().includes('nursing') || 
                          (subject || '').toLowerCase().includes('medical') ||
                          (subject || '').toLowerCase().includes('healthcare');
      
      topicsCovered = isHealthcare ? [
        'Patient Assessment',
        'Clinical Decision Making',
        'Pharmacology',
        'Safety Protocols',
        'Evidence-Based Practice'
      ] : [
        'Core Concepts',
        'Practical Applications',
        'Problem Solving', 
        'Standards & Guidelines',
        'Decision Making'
      ];
    }
    
    console.log("Final Topics Covered:", topicsCovered);

    // Keep topics short (max ~6 words) and limit to 5-8 bullets
    topicsCovered = topicsCovered
      .map((t: string) => (t || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((t: string) => {
        const words = t.split(' ');
        return words.length > 6 ? words.slice(0, 6).join(' ') : t;
      });

    // Render domain blueprints summary if provided (compact list of domain -> coreConcepts/keywords)
    let domainBlueprintHtml = '';
    try {
      if (domainBlueprints && Object.keys(domainBlueprints).length) {
        const entries = Object.entries(domainBlueprints as Record<string, any>);
        domainBlueprintHtml = `<div class="exam-sections-box"><h3>DOMAIN BLUEPRINTS</h3><ul class="sections-list">` + entries.map(([d, bp]) => {
          const core = Array.isArray(bp.coreConcepts) ? bp.coreConcepts.join(', ') : (bp.coreConcepts || '').toString();
          const keys = Array.isArray(bp.keywords) ? bp.keywords.join(', ') : (bp.keywords || '').toString();
          return `<li><strong>${d}</strong>: ${core}${keys ? ' — keywords: ' + keys : ''}</li>`;
        }).join('') + `</ul></div>`;
      }
    } catch (e) {
      console.warn('Failed to render domainBlueprints for PDF:', (e as any)?.message || e);
      domainBlueprintHtml = '';
    }

    const htmlContent = `
        <!DOCTYPE html>
<html>
<head>
    <title>${examTitle}</title>
    <style>
        /* PROFESSIONAL ACADEMIC EXAM STYLING */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Source+Serif+Pro:wght@400;600;700&display=swap');
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        :root {
            /* PROFESSIONAL ACADEMIC COLOR SCHEME */
            --primary-navy: #0A1A2F;
            --charcoal-navy: #1C2A3A;
            --accent-grey: #C2C7D0;
            --body-bg: #F8F8F8;
            --white: #FFFFFF;
            --text-dark: #2C3E50;
            --text-medium: #5A6C7D;
            
            /* TYPOGRAPHY */
            --font-heading: 'Source Serif Pro', 'Times New Roman', serif;
            --font-body: 'Inter', 'Helvetica Neue', Arial, sans-serif;
        }
        
        body {
            font-family: var(--font-body);
            padding: 0;
            margin: 0;
            line-height: 1.6;
            background-color: var(--body-bg);
            color: var(--text-dark);
            width: 100%;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        /* Print color preservation for all elements */
        @media print {
            * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            
            .header {
                background: linear-gradient(135deg, #1e3a8a 0%, #1e3a8a 100%) !important;
                color: white !important;
            }
            
            .university-name {
                text-shadow: 2px 2px 4px rgba(0,0,0,0.3) !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            
            .exam-session {
                text-shadow: 1px 1px 3px rgba(0,0,0,0.4) !important;
                color: rgba(255,255,255,0.95) !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            
            .correct-answer {
                color: #2E7D32 !important;
                background-color: rgba(46, 125, 50, 0.1) !important;
            }
            
            /* Remove highlight background on print for instructions/feature headings */
            .instructions-box {
              background: transparent !important;
              color: inherit !important;
            }
        }

        /* CONTENT CONTAINER - PROFESSIONAL LAYOUT */
        .content-container {
            width: 100%;
            margin: 0 auto;
        }
        
        /* INNER PAGES BACKGROUND */
        .inner-content {
            background-color: var(--body-bg);
            padding: 30px 50px;
            min-height: auto;
            page-break-inside: auto;
        }

        /* PROFESSIONAL COVER PAGE DESIGN */
        .header {
            background: var(--primary-navy);
            color: var(--white);
            padding: 30px 40px;
            min-height: auto;
            max-height: 90vh;
            width: 100%;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            align-items: center;
            text-align: center;
            page-break-inside: avoid;
            break-inside: avoid;
            overflow: hidden;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .exam-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
            text-align: left;
        }

        .main-title-section {
            text-align: center;
            padding: 20px 0;
        }

        .main-exam-title {
            font-family: var(--font-heading);
            font-size: 1.6rem;
            font-weight: 700;
            margin-bottom: 6px;
            letter-spacing: -0.02em;
            color: var(--white);
            text-align: center;
            line-height: 1.1;
            max-width: 900px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .exam-subheading {
            font-family: var(--font-body);
            font-size: 0.95rem;
            font-weight: 600;
            color: rgba(255,255,255,0.95);
            text-align: center;
            line-height: 1.4;
            margin-bottom: 32px;
            max-width: 700px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        
        .exam-subheading .year {
            color: #FFD700;
            font-weight: 700;
        }
        
        .exam-subheading .grade {
            color: #90EE90;
            font-weight: 700;
        }
        
        .exam-subtitle strong {
            font-weight: 800;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }

        .institution-info .department {
            font-size: 12px;
            font-weight: 400;
            opacity: 0.9;
        }

        .exam-details {
            text-align: right;
            font-size: 10px;
            line-height: 1.4;
        }

        .exam-session {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            color: rgba(255,255,255,0.95);
            text-shadow: 1px 1px 3px rgba(0,0,0,0.4);
            font-family: 'Georgia', 'Times New Roman', serif;
            margin-bottom: 3px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .exam-details div {
            margin-bottom: 3px;
        }

        .exam-title-section {
            text-align: center;
            margin: 20px 0;
            border-bottom: 2px solid rgba(255,255,255,0.3);
            padding-bottom: 15px;
        }

        .title {
            color: white;
            font-size: 22px;
            margin: 0 0 10px 0;
            font-weight: 700;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .subtitle {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            margin-top: 10px;
            font-weight: 500;
            color: rgba(255,255,255,0.9);
        }

        .instructions-box {
            background: white;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 12px;
            margin: 8px 0;
            width: 100%;
            max-width: 800px;
            page-break-inside: avoid;
            break-inside: avoid;
        }

        .instructions-box h3 {
            font-family: var(--font-heading);
            font-size: 1rem;
            font-weight: 600;
            color: black;
            margin-bottom: 8px;
            text-align: left;
            border-bottom: 2px solid #ccc;
            padding-bottom: 4px;
        }

        .instructions-list {
            margin: 0;
            padding-left: 0;
            list-style: none;
            text-align: left;
        }

        .instructions-list li {
            margin-bottom: 6px;
            font-size: 0.85rem;
            line-height: 1.3;
            color: rgba(255,255,255,0.9);
            position: relative;
            padding-left: 18px;
            text-align: left;
        }
        
        .instructions-list li::before {
            content: '•';
            color: var(--white);
            font-weight: bold;
            position: absolute;
            left: 0;
            top: 0;
        }

        /* Dynamic cover page styles */
        /* PROFESSIONAL SECTION STYLING */
        .cover-section {
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 8px;
            padding: 32px;
            margin: 24px 0;
            width: 100%;
            max-width: 800px;
            backdrop-filter: blur(10px);
        }
        
        .exam-overview-section {
            background: white;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 12px;
            margin: 8px 0;
            width: 100%;
            max-width: 800px;
            page-break-inside: avoid;
            break-inside: avoid;
        }

        .exam-overview-section h3 {
            font-family: var(--font-heading);
            font-size: 0.95rem;
            font-weight: 600;
            color: black;
            margin-bottom: 6px;
            text-align: left;
            border-bottom: 2px solid #ccc;
            padding-bottom: 3px;
        }        .exam-overview-text {
            font-size: 13px;
            line-height: 1.5;
            color: black;
            margin: 0;
        }

        .exam-sections-box {
            background: white;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 12px;
            margin: 8px 0;
            width: 100%;
            max-width: 800px;
            page-break-inside: avoid;
            break-inside: avoid;
        }

        .exam-sections-box h3 {
            font-family: var(--font-heading);
            font-size: 0.95rem;
            font-weight: 600;
            color: black;
            margin-bottom: 6px;
            text-align: left;
            border-bottom: 2px solid #ccc;
            padding-bottom: 3px;
        }        .sections-intro {
            font-size: 12px;
            margin-bottom: 15px;
            font-style: italic;
        }

        .core-testing-areas h4 {
            font-size: 13px;
            font-weight: 700;
            margin: 10px 0;
            color: #1e3a8a;
        }

        .sections-list {
            margin: 0;
            padding-left: 0;
            list-style: none;
        }

        .sections-list li {
            margin-bottom: 6px;
            font-size: 0.85rem;
            line-height: 1.4;
            color: black;
            position: relative;
            padding-left: 18px;
        }
        
        .sections-list li::before {
            content: '→';
            color: black;
            position: absolute;
            left: 0;
            top: 0;
        }
        
        .exam-overview-text {
            font-size: 0.85rem;
            line-height: 1.4;
            color: black;
            margin: 0;
        }



        .candidate-info {
            border-top: 1px solid #1e3a8a;
            padding-top: 15px;
            margin-top: 15px;
        }

        .info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            font-size: 12px;
            font-weight: 500;
        }

        .exam-start-notice {
            text-align: center;
            font-size: 18px;
            font-weight: 700;
            color: #1e3a8a;
            margin: 30px 0;
            padding: 15px;
            border: 2px solid #1e3a8a;
            background: #f0f4ff;
        }

        /* Icons */
        .icon {
            flex-shrink: 0;
            filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
        }
        .icon-bulb {
            opacity: 0.9;
        }

        /* Bullet separator */
        .bullet {
            margin: 0 4px;
        }

        /* PROFESSIONAL QUESTION STYLING - CONTINUOUS FLOW */
        .question {
            background: var(--white);
            border: 1px solid var(--accent-grey);
            border-radius: 8px;
            padding: 14px;
            margin-bottom: 10px;
            page-break-inside: auto;
            break-inside: auto;
            width: 100%;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            orphans: 2;
            widows: 2;
            overflow: visible;
        }

        .question-number {
            font-family: var(--font-heading);
            color: var(--primary-navy);
            font-weight: 700;
            font-size: 1rem;
            margin-bottom: 8px;
            padding-bottom: 6px;
            border-bottom: 2px solid var(--accent-grey);
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            width: 100%;
        }

        .question-text {
            font-family: var(--font-body);
            margin: 10px 0 12px 0;
            font-size: 0.9rem;
            line-height: 1.5;
            color: var(--text-dark);
            width: 100%;
        }

        .answer-options {
            margin: 12px 0;
            width: 100%;
        }

        .option {
            margin: 4px 0;
            font-size: 0.85rem;
            line-height: 1.4;
            padding: 4px 0;
            color: var(--text-dark);
            width: 100%;
            border-bottom: 1px solid #F0F0F0;
            text-indent: -2em;
            padding-left: 2em;
        }

        .answer-title {
            font-family: var(--font-heading);
            color: var(--charcoal-navy);
            font-weight: 600;
            margin: 12px 0 6px 0;
            font-size: 0.9rem;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            width: 100%;
        }

        .answer-content {
            margin: 6px 0 10px 0;
            padding: 12px 16px;
            background: #F8F9FA;
            border-left: 4px solid var(--charcoal-navy);
            border-radius: 0 4px 4px 0;
            color: var(--text-dark);
            font-size: 0.85rem;
            line-height: 1.4;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            width: 100%;
        }

        .correct-answer {
            color: var(--primary-navy);
            background-color: rgba(10, 26, 47, 0.08);
            font-weight: 600;
            padding: 12px 16px;
            border-radius: 6px;
            border-left: 4px solid var(--primary-navy);
            margin: 6px 0 10px 0;
            font-size: 0.85rem;
            line-height: 1.4;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            width: 100%;
        }

        .rationale {
            background-color: #F5F7FA;
            padding: 12px 16px;
            border-radius: 6px;
            margin: 8px 0;
            border-left: 4px solid var(--accent-grey);
            font-size: 0.8rem;
            line-height: 1.4;
            color: var(--text-medium);
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            width: 100%;
        }
        
        .rationale strong {
            color: var(--charcoal-navy);
            font-family: var(--font-heading);
            font-weight: 600;
        }

        .question-image {
            margin: 8px 0;
            text-align: center;
            width: 100%;
        }

        .question-image img {
            max-width: 100%;
            height: auto;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        
        hr {
            border: 0;
            height: 1px;
            background: linear-gradient(to right, transparent, var(--accent-grey), transparent);
            margin: 12px 0;
            width: 100%;
        }
        
        /* Exam footer elements */
        .exam-footer {
            background: linear-gradient(135deg, #1e3a8a 0%, #1e3a8a 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            margin: 40px 0 20px 0;
            text-align: center;
            width: 100%;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
            border: 2px solid #1e3a8a;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        
        .exam-end-notice {
            font-size: 18px;
            margin-bottom: 15px;
            font-weight: 700;
            letter-spacing: 1px;
        }
        
        .footer-info {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            opacity: 0.9;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid rgba(255,255,255,0.3);
        }
        
        .sales-points {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 20px;
            margin: 20px 0;
        }
        
        .sales-point {
            background: rgba(255, 255, 255, 0.1);
            padding: 15px;
            border-radius: 8px;
            flex: 1;
            min-width: 200px;
            max-width: 250px;
        }
        
        .sales-icon {
            font-size: 30px;
            margin-bottom: 10px;
            color: #2b6b6e;
        }
        
        .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, #1e3a8a 0%, #2b6b6e 100%);
            color: white;
            padding: 15px 30px;
            border-radius: 50px;
            text-decoration: none;
            font-weight: bold;
            font-size: 18px;
            margin-top: 15px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
            transition: all 0.3s ease;
        }
        
        .cta-button:hover {
            transform: translateY(-3px);
            box-shadow: 0 6px 15px rgba(0, 0, 0, 0.3);
        }

        /* Print-specific styling */
        @media print {
            @page {
                size: A4;
                margin: 0.5in;
                marks: none;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;

                @bottom-right {
                    content: "Page " counter(page);
                    font-size: 10pt;
                    color: #666;
                    font-family: 'Inter', Arial, sans-serif;
                    padding-top: 8px;
                    margin-top: 12px;
                    border-top: 1px solid #ddd;
                }
            }

            /* PROFESSIONAL PRINT LAYOUT */
            .no-print {
                display: none !important;
            }

            .content-container {
                margin: 0 auto !important;
                width: 100% !important;
                max-width: 100% !important;
            }
            
            .inner-content {
                padding: 30px !important;
                background-color: var(--body-bg) !important;
            }
            
            .header {
                padding: 25px 35px !important;
                background: var(--primary-navy) !important;
                color: var(--white) !important;
                min-height: auto !important;
                max-height: 85vh !important;
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                page-break-after: auto !important;
                break-after: auto !important;
                overflow: hidden !important;
            }

            /* Cover page content boxes optimization */
            .exam-overview-section, .instructions-box, .exam-sections-box {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                margin: 6px 0 !important;
                padding: 10px !important;
            }

            /* Prevent cover page from overflowing */
            .main-exam-title {
                font-size: 1.4rem !important;
                margin-bottom: 4px !important;
            }

            .exam-subheading {
                font-size: 0.85rem !important;
                font-weight: 600 !important;
                margin-bottom: 20px !important;
            }
            
            .exam-subheading .year {
                color: #FFD700 !important;
                font-weight: 700 !important;
            }
            
            .exam-subheading .grade {
                color: #90EE90 !important;
                font-weight: 700 !important;
            }

            /* QUESTION LAYOUT CONTROL - CONTINUOUS FLOW WITH BACKGROUND BOXES */
            .question {
                page-break-inside: auto !important;
                break-inside: auto !important;
                width: 100% !important;
                background: var(--white) !important;
                border: 1px solid var(--accent-grey) !important;
                border-radius: 8px !important;
                padding: 14px !important;
                margin-bottom: 10px !important;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05) !important;
                orphans: 2 !important;
                widows: 2 !important;
                overflow: visible !important;
            }
            
            /* Allow natural page breaks - questions flow continuously */
            .question {
                page-break-after: auto !important;
                break-after: auto !important;
                page-break-before: auto !important;
                break-before: auto !important;
            }

            /* Allow question components to break naturally when needed */
            .question * {
                page-break-inside: auto !important;
                break-inside: auto !important;
            }

            /* Allow question content to flow naturally */
            .question-number, .question-text, .answer-options, 
            .answer-title, .answer-content, .rationale {
                page-break-inside: auto !important;
                break-inside: auto !important;
                width: 100% !important;
            }



            /* Allow rationale and answers to flow naturally */
            .rationale {
                page-break-inside: auto !important;
                break-inside: auto !important;
                width: 100% !important;
            }
            
            /* Allow answer sections to break when necessary */
            .answer-options, .correct-answer {
                page-break-inside: auto !important;
                break-inside: auto !important;
            }
            
            .sales-banner, .cta-button {
                display: block !important;
            }

            /* Force color preservation */
            * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
            }

            /* Optimize text sizing for print */
            .question-number {
                font-size: 0.95rem !important;
                margin-bottom: 6px !important;
                padding-bottom: 4px !important;
            }

            .question-text {
                font-size: 0.85rem !important;
                margin: 8px 0 10px 0 !important;
                line-height: 1.4 !important;
            }

            .answer-options {
                margin: 8px 0 !important;
            }

            .option {
                font-size: 0.8rem !important;
                margin: 2px 0 !important;
                padding: 2px 0 !important;
                line-height: 1.3 !important;
                text-indent: -2em !important;
                padding-left: 2em !important;
            }

            .answer-title {
                font-size: 0.85rem !important;
                margin: 8px 0 4px 0 !important;
            }

            .answer-content, .correct-answer {
                font-size: 0.8rem !important;
                padding: 8px 12px !important;
                margin: 4px 0 6px 0 !important;
                line-height: 1.3 !important;
            }

            .rationale {
                font-size: 0.75rem !important;
                padding: 8px 12px !important;
                margin: 4px 0 !important;
                line-height: 1.3 !important;
            }

            /* HR styling for print */
            hr {
                page-break-inside: auto !important;
                break-inside: auto !important;
                margin: 6px 0 !important;
                border: 0 !important;
                height: 1px !important;
                background: var(--accent-grey) !important;
            }
        }

    </style>
</head>
<body>
    <div class="content-container">
        <!-- PROFESSIONAL COVER PAGE -->
        <div class="header">
            <div class="main-exam-title">${coverPageContent.title}</div>
            <div class="exam-subheading">${coverPageContent.subtitle}</div>
            
            <div class="exam-overview-section">
                <h3>EXAM OVERVIEW</h3>
                <p class="exam-overview-text">${coverPageContent.exam_overview}</p>
            </div>
            
            <div class="instructions-box">
                <h3>EXAM FEATURES</h3>
                <ul class="instructions-list">
                    ${coverPageContent.exam_features.map((feature: string) => `<li>${feature}</li>`).join('')}
                </ul>
            </div>
            
            ${processedCoreAreas && processedCoreAreas.length > 0 ? `
            <div class="exam-sections-box">
                <h3>CORE TESTING AREAS</h3>
                <ul class="sections-list">
                    ${processedCoreAreas.map((section: string) => `<li>${sanitizeUnicode(section)}</li>`).join('')}
                </ul>
            </div>
            ` : ''}
            ${domainBlueprintHtml ? domainBlueprintHtml : ''}
        </div>
        
        <!-- PROFESSIONAL EXAM CONTENT -->
        <div class="inner-content">
            ${contentHtml}
        </div>
        
        <div class="exam-footer">
            <div class="footer-content">
                <div class="exam-end-notice">
                    <strong>KEEP LEARNING!</strong>
                </div>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    // Generate complete HTML document with auto-print functionality
    const htmlDocument = generateCompleteHTML(coverPageContent, contentHtml, processedCoreAreas, examTitle || "Exam");

    return new Response(htmlDocument, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error: any) {
    console.error("PDF generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate PDF", details: error.message },
      { status: 500 }
    );
  }
}
