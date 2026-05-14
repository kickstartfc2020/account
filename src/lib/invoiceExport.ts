import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

type BuildPdfOptions = {
  element: HTMLElement;
  fileName: string;
};

export async function buildInvoicePdfBlob({ element }: BuildPdfOptions): Promise<Blob> {
  const imageData = await toPng(element, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    skipFonts: false,
  });
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  const image = new Image();
  image.src = imageData;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to load invoice image data.'));
  });

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.width;
  sourceCanvas.height = image.height;
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    throw new Error('Failed to render invoice image.');
  }
  sourceCtx.drawImage(image, 0, 0);

  const { width, height } = sourceCanvas;
  const pixels = sourceCtx.getImageData(0, 0, width, height).data;

  let top = height;
  let left = width;
  let right = 0;
  let bottom = 0;

  // Trim near-white margins to reduce extra top/bottom blank space in PDF.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const a = pixels[index + 3];
      const isContent = a > 8 && !(r > 248 && g > 248 && b > 248);
      if (!isContent) continue;

      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  const hasContent = right > left && bottom > top;
  const trimPadding = 8;
  const cropX = hasContent ? Math.max(0, left - trimPadding) : 0;
  const cropY = hasContent ? Math.max(0, top - trimPadding) : 0;
  const cropWidth = hasContent ? Math.min(width - cropX, right - left + trimPadding * 2) : width;
  const cropHeight = hasContent ? Math.min(height - cropY, bottom - top + trimPadding * 2) : height;

  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = cropWidth;
  croppedCanvas.height = cropHeight;
  const croppedCtx = croppedCanvas.getContext('2d');
  if (!croppedCtx) {
    throw new Error('Failed to crop invoice image.');
  }
  croppedCtx.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const croppedImageData = croppedCanvas.toDataURL('image/png');

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 1;
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;

  const widthScale = maxWidth / cropWidth;
  const heightScale = maxHeight / cropHeight;
  const scale = Math.min(widthScale, heightScale);

  const imageWidth = cropWidth * scale;
  const imageHeight = cropHeight * scale;
  const offsetX = (pageWidth - imageWidth) / 2;
  const offsetY = (pageHeight - imageHeight) / 2;

  // Always export to a single sheet by fitting the full invoice in one page.
  pdf.addImage(croppedImageData, 'PNG', offsetX, offsetY, imageWidth, imageHeight);

  return pdf.output('blob');
}

export function downloadPdfBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function sharePdfByEmail(blob: Blob, fileName: string, subject: string, body: string) {
  const file = new File([blob], fileName, { type: 'application/pdf' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: subject,
      text: body,
    });
    return;
  }

  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${body}\n\nPlease attach ${fileName} manually if attachment is not supported.`)}`;
  window.location.href = mailto;
}
