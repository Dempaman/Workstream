import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Attachment } from "../shared/types";

export function decodeImage(dataUrl: string) {
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Use PNG, JPEG, or WebP images.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 4 * 1024 * 1024)
    throw new Error("Each image must be at most 4 MB.");
  const valid =
    match[1] === "png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === "jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid)
    throw new Error("The image content does not match its file type.");
  return { bytes, mime: `image/${match[1]}`, extension: match[1] };
}
export class Attachments {
  constructor(private directory: string) {}
  save(images: { name: string; dataUrl: string }[]): Attachment[] {
    if (images.length > 6) throw new Error("Attach at most six images.");
    const decoded = images.map((image) => ({
      ...decodeImage(image.dataUrl),
      name: image.name,
    }));
    mkdirSync(this.directory, { recursive: true });
    return decoded.map((image) => {
      const id = `${randomUUID()}.${image.extension}`;
      writeFileSync(this.path(id), image.bytes, { flag: "wx", mode: 0o600 });
      return { id, name: image.name, mime: image.mime };
    });
  }
  path(id: string) {
    if (!/^[a-f0-9-]{36}\.(png|jpeg|webp)$/.test(id))
      throw new Error("Invalid attachment.");
    return join(this.directory, id);
  }
  read(image: Attachment) {
    return `data:${image.mime};base64,${readFileSync(this.path(image.id)).toString("base64")}`;
  }
}
