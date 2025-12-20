import { NextRequest, NextResponse } from "next/server";
import { authClient } from "@/lib/auth-client";

export async function POST(request: NextRequest) {
  try {
    // Get the authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse form data to get the uploaded file
    const formData = await request.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Check file type and size
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    // Check file size limit (50MB)
    const maxFileSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxFileSize) {
      return NextResponse.json({ 
        error: `PDF file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 50MB.` 
      }, { status: 400 });
    }

    try {
      // Convert file to buffer for server-side processing
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Dynamic import to handle potential module issues
      const pdfParse = require("pdf-parse");
      const result = await pdfParse(buffer);
      
      return NextResponse.json({ 
        text: result.text,
        info: {
          pages: result.numpages,
          title: result.info?.Title || file.name,
        }
      });
      
    } catch (parseError: any) {
      console.error("PDF parsing error:", parseError);
      return NextResponse.json({ 
        error: `Failed to parse PDF: ${parseError.message}` 
      }, { status: 400 });
    }

  } catch (error: any) {
    console.error("PDF parse API error:", error);
    return NextResponse.json({ 
      error: "Internal server error" 
    }, { status: 500 });
  }
}