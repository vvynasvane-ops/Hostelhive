// ============================================================
// Photo upload without Firebase Storage.
//
// Firebase Storage needs the Blaze (pay-as-you-go) plan enabled on the
// project. To keep HostelHive working on the free Spark plan, photos
// are resized and compressed in the browser with a <canvas>, turned into
// a JPEG data: URL, and stored directly as a string field in Firestore
// (cover photo plus a small gallery array on each hostel doc — all public,
// nothing gated behind a code). A Firestore document tops out at 1MB, so
// images are kept small enough that a handful of them fit comfortably.
// ============================================================

/**
 * Reads an image file, downsizes it to fit within maxDim x maxDim while
 * keeping aspect ratio, and returns a compressed JPEG data URL.
 */
export function fileToCompressedDataURL(file, maxDim = 480, quality = 0.6) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't decode that image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Rough size estimate in KB for a data URL string, for a friendly hint in the UI. */
export function dataUrlSizeKB(dataUrl) {
  return Math.round((dataUrl.length * 0.75) / 1024);
}
