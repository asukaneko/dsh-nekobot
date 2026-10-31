export const AVATAR_LIMIT = 4_000_000;
export const AVATAR_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
const EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
function mimeOf(file: File): string {
  const declared = (file.type || "").toLowerCase();
  if ((AVATAR_TYPES as readonly string[]).includes(declared)) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return EXTENSIONS[extension] || "";
}
function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("invalidFile"));
    reader.onload = () =>
      typeof reader.result === "string" && reader.result.includes(",")
        ? resolve(reader.result)
        : reject(new Error("invalidFile"));
    reader.readAsDataURL(file);
  });
}
/** 读取角色立绘为 data URL；类型和大小在保存前就拒绝，避免写坏角色卡。 */
export async function readAvatarFile(file: File): Promise<string> {
  const type = mimeOf(file);
  if (!type) throw new Error("invalidAvatarType");
  if (file.size <= 0) throw new Error("invalidFile");
  if (file.size > AVATAR_LIMIT) throw new Error("avatarTooLarge");
  const data = await readAsDataURL(file);
  const base64 = data.slice(data.indexOf(",") + 1);
  if (!base64) throw new Error("invalidFile");
  // 有些系统给出的 MIME 为空或不准，统一按检测到的类型重建前缀。
  return `data:${type};base64,${base64}`;
}
