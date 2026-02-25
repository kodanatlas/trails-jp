export type UserRole = "owner" | "admin";
export type UserStatus = "active" | "suspended";
export type ReviewStatus = "draft" | "pending_review" | "approved" | "revision_requested" | "rejected";
export type Visibility = "full" | "low_res" | "polygon_only";

export interface User {
  id: string;
  email: string;
  display_name: string;
  organization?: string;
  bio?: string;
  role: UserRole;
  status: UserStatus;
  email_verified: boolean;
}

export interface MapUpload {
  id: string;
  owner_id: string;
  name: string;
  prefecture: string;
  city: string;
  terrain_type: string;
  scale: string;
  contour_interval: number;
  created_year: number;
  description?: string;
  tags: string[];
  visibility: Visibility;
  review_status: ReviewStatus;
  review_comment?: string;
  image_file?: File;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  rotation_deg: number;
}
