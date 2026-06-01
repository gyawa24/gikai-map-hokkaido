import type { Member } from "@/types/member";
import { publicRawUrl } from "@/lib/publicRawUrl";

type WithMemberPhotoUrl = {
  photo_url?: string;
};

export function publicMemberPhotoUrl(photoUrl?: string): string | undefined {
  if (!photoUrl) return undefined;
  return photoUrl.startsWith("/members/") ? publicRawUrl(photoUrl) : photoUrl;
}

export function withPublicMemberPhotoUrl<T extends WithMemberPhotoUrl>(row: T): T {
  const photoUrl = publicMemberPhotoUrl(row.photo_url);
  if (photoUrl === row.photo_url) return row;
  return { ...row, photo_url: photoUrl };
}

export function withPublicMemberPhotoUrls(members: Member[]): Member[] {
  return members.map(withPublicMemberPhotoUrl);
}
