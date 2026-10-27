export const SOURCE_FILE_ACCEPT =
  '.pdf,.docx,.txt,.md,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function checkText(text, limit) {
  const cleaned = text.replace(/\u0000/g, '').trim();
  if (!cleaned)
    throw new Error(
      'No readable text was found. For a scanned document, paste its text or use a PDF with selectable text.',
    );
  if (cleaned.length > limit)
    throw new Error(
      `This document exceeds the ${limit.toLocaleString()} character limit. Import a shorter document or paste the relevant passages.`,
    );
  return cleaned;
}

export async function readSourceDocument(file, limit) {
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a document smaller than 10 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['pdf', 'docx', 'txt', 'md'].includes(extension))
    throw new Error('Choose a PDF, Word (.docx), text (.txt), or Markdown (.md) document.');

  if (extension === 'txt' || extension === 'md') return checkText(await file.text(), limit);
  const data = await file.arrayBuffer();
  if (extension === 'docx') {
    try {
      const module = await import('mammoth/mammoth.browser.js');
      const mammoth = module.default || module;
      const result = await mammoth.extractRawText({ arrayBuffer: data });
      return checkText(result.value, limit);
    } catch (error) {
      if (
        error.message?.startsWith('No readable text') ||
        error.message?.includes('character limit')
      )
        throw error;
      throw new Error(
        'This Word document could not be read. Save it as a .docx file, try another file, or paste its text.',
      );
    }
  }

  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let task;
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false });
    const pdf = await task.promise;
    const pages = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item) => typeof item.str === 'string')
        .map((item) => item.str + (item.hasEOL ? '\n' : ' '))
        .join('');
      length += text.length + 2;
      if (length > limit)
        throw new Error(
          `This document exceeds the ${limit.toLocaleString()} character limit. Import a shorter document or paste the relevant passages.`,
        );
      pages.push(text);
      page.cleanup();
    }
    return checkText(pages.join('\n\n'), limit);
  } catch (error) {
    if (error.message?.startsWith('No readable text') || error.message?.includes('character limit'))
      throw error;
    if (error.name === 'PasswordException')
      throw new Error('This PDF requires a password. Import an unlocked copy or paste its text.');
    throw new Error('This PDF could not be read. Try another PDF or paste its text.');
  } finally {
    await task?.destroy();
  }
}
