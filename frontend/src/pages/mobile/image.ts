/** Largest size that fits `max` on its longest side, never upscaling. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Validate a picked photo before it is queued. Returns an error message or null. */
export function photoProblem(file: { type: string; size: number }, maxBytes: number): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose a photo (JPEG, PNG or WebP).'
  if (file.size === 0) return 'The photo is empty.'
  if (file.size > maxBytes) return `The photo is larger than ${Math.round(maxBytes / 1048576)} MB.`
  return null
}

/**
 * Shrink a camera photo to about 1600 px JPEG so it uploads quickly on mobile data. Falls back to the original file when the
 * browser cannot decode it (the server still validates the real file type).
 */
export async function downscale(file: File, max = 1600, quality = 0.85): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const { width, height } = fitWithin(bmp.width, bmp.height, max)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height)
    bmp.close?.()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}
