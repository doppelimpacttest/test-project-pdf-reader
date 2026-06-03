import type { PdfParseResult } from "../types/index.js";
import { Buffer } from "node:buffer";

const PDF_PARSE_PACKAGE: string = "pdf-parse/lib/pdf-parse.js";

export async function extractTextFromPdf(data: Buffer): Promise<PdfParseResult> {
  let pdfParse: ((buffer: Buffer, options?: Record<string, unknown>) => Promise<{ text: string; numpages: number }>) | undefined;

  try {
    const mod = await import(PDF_PARSE_PACKAGE);
    pdfParse = mod.default ?? mod;
  } catch {
    throw new Error(
      `Failed to load "${PDF_PARSE_PACKAGE}". Run "npm install" first.`
    );
  }

  const result = await pdfParse!(data, {});

  return {
    text: result.text,
    pageCount: result.numpages,
  };
}
