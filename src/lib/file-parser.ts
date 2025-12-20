import mammoth from "mammoth";

export async function extractTextFromFile(file: File): Promise<string> {
  const fileExtension = file.name.split(".").pop()?.toLowerCase();

  try {
    switch (fileExtension) {
      case "txt":
      case "md":
        return await extractTextFromTextFile(file);
      
      case "pdf":
        return await extractTextFromPDF(file);
      
      case "docx":
        return await extractTextFromDOCX(file);
      
      case "doc":
        // DOC files are legacy format, suggest converting to DOCX
        throw new Error("Legacy .doc format is not supported. Please convert to .docx format.");
      
      default:
        throw new Error(`Unsupported file format: .${fileExtension}`);
    }
  } catch (error: any) {
    throw new Error(`Failed to parse ${file.name}: ${error.message}`);
  }
}

async function extractTextFromTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      resolve(text);
    };
    reader.onerror = () => reject(new Error("Failed to read text file"));
    reader.readAsText(file);
  });
}

async function extractTextFromPDF(file: File): Promise<string> {
  // Add file size check to prevent memory issues
  const maxFileSize = 50 * 1024 * 1024; // 50MB limit
  if (file.size > maxFileSize) {
    throw new Error(`PDF file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 50MB.`);
  }

  // Try server-side parsing first (most reliable and memory efficient)
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    const token = typeof window !== 'undefined' ? localStorage.getItem("bearer_token") : null;
    const response = await fetch('/api/parse-pdf', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });
    
    if (response.ok) {
      const result = await response.json();
      return result.text;
    } else {
      console.warn('Server-side PDF parsing failed, trying client-side...');
    }
  } catch (serverError: any) {
    console.warn('Server-side PDF parsing failed:', serverError);
  }

  // Fallback to client-side parsing with memory optimization
  let arrayBuffer: ArrayBuffer | null = null;
  let uint8Array: Uint8Array | null = null;
  
  try {
    arrayBuffer = await file.arrayBuffer();
    uint8Array = new Uint8Array(arrayBuffer);
    
    // Only try pdfjs-dist on client-side since pdf-parse is Node.js only
    const pdfjs = await import("pdfjs-dist");
    
    // Try multiple worker sources with fallbacks
    const workerSources = [
      '/pdf.worker.min.js', // Local worker (copied from node_modules)
      `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`,
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`,
      `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.mjs`
    ];
    
    let lastError;
    for (const workerSrc of workerSources) {
      try {
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        
        const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;
        let fullText = "";
        
        // Process pages in chunks to reduce memory usage
        const pageChunkSize = 5; // Process 5 pages at a time
        for (let i = 1; i <= pdf.numPages; i += pageChunkSize) {
          const endPage = Math.min(i + pageChunkSize - 1, pdf.numPages);
          
          for (let pageNum = i; pageNum <= endPage; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
              .map((item: any) => item.str)
              .join(" ");
            fullText += pageText + "\n\n";
            
            // Force cleanup of page object
            page.cleanup?.();
          }
          
          // Small delay to allow garbage collection
          if (i + pageChunkSize <= pdf.numPages) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        
        // Cleanup PDF document
        pdf.destroy?.();
        
        return fullText.trim();
        
      } catch (error: any) {
        console.warn(`Failed to load PDF.js worker from ${workerSrc}:`, error);
        lastError = error;
        continue;
      }
    }
    
    throw lastError || new Error("All PDF.js worker sources failed");
    
  } catch (pdfJsError: any) {
    throw new Error(`PDF parsing failed. Error: ${pdfJsError?.message || 'Unknown error'}`);
  } finally {
    // Explicit cleanup to help garbage collection
    if (uint8Array) {
      uint8Array = null;
    }
    if (arrayBuffer) {
      arrayBuffer = null;
    }
  }
}

async function extractTextFromDOCX(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

export async function extractTextFromMultipleFiles(files: File[]): Promise<string> {
  const textPromises = files.map(file => extractTextFromFile(file));
  const texts = await Promise.all(textPromises);
  
  // Combine all texts with file separators
  return texts
    .map((text, index) => {
      const fileName = files[index].name;
      return `=== Source: ${fileName} ===\n\n${text}\n\n`;
    })
    .join("\n");
}