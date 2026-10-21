import { useEffect, useState, type ReactNode } from "react";
import type { Attachment } from "../../shared/types";
import { bridge } from "@/lib/bridge";

export type ImageInput = { name: string; dataUrl: string };
export function ImagePicker({
  images,
  onChange,
  onBusy,
  children,
}: {
  images: ImageInput[];
  onChange: (images: ImageInput[]) => void;
  onBusy: (busy: boolean) => void;
  children?: ReactNode;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function add(files: File[]) {
    setError("");
    if (files.length + images.length > 6) {
      setError("Attach at most six images.");
      return;
    }
    if (
      files.some(
        (file) =>
          !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
          file.size > 4 * 1024 * 1024,
      )
    ) {
      setError("Use PNG, JPEG, or WebP images, up to 4 MB each.");
      return;
    }
    setLoading(true);
    onBusy(true);
    try {
      const additions = await Promise.all(
        files.map(
          (file) =>
            new Promise<ImageInput>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({ name: file.name, dataUrl: String(reader.result) });
              reader.onerror = reject;
              reader.readAsDataURL(file);
            }),
        ),
      );
      onChange([...images, ...additions]);
    } catch {
      setError("An image could not be read. Try selecting it again.");
    } finally {
      setLoading(false);
      onBusy(false);
    }
  }
  return (
    <div
      className="image-picker"
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files);
        if (files.length && !loading) {
          event.preventDefault();
          void add(files);
        }
      }}
    >
      {children}
      <label>
        Reference images
        <input
          aria-label="Attach reference images"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={loading}
          onChange={(event) => {
            void add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </label>
      <p tabIndex={0}>
        Choose images or focus here and paste a screenshot. Up to 6 images, 4 MB
        each.
      </p>
      {loading && <p role="status">Reading images…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="image-grid">
        {images.map((image, i) => (
          <figure key={i}>
            <img src={image.dataUrl} alt={image.name} />
            <figcaption>{image.name}</figcaption>
            <button
              type="button"
              disabled={loading}
              onClick={() => onChange(images.filter((_, index) => i !== index))}
            >
              Remove image {i + 1}
            </button>
          </figure>
        ))}
      </div>
    </div>
  );
}
function SavedImage({ image }: { image: Attachment }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void bridge
      .attachment(image.id)
      .then((src) => {
        if (active) setSrc(src);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [image.id]);
  return (
    <figure>
      {src && (
        <a href={src} download={image.name}>
          <img src={src} alt={image.name} />
        </a>
      )}
      <figcaption>
        {image.name}
        {failed ? " — image unavailable" : ""}
      </figcaption>
    </figure>
  );
}
export function SavedImages({ images }: { images: Attachment[] }) {
  return (
    <div className="image-grid">
      {images.map((image) => (
        <SavedImage key={image.id} image={image} />
      ))}
    </div>
  );
}
