export type TerrainType = "forest" | "park" | "urban" | "sand" | "mixed";

export interface OrienteeringMap {
  id: string;
  name: string;
  prefecture: string;
  city: string;
  terrain_type: TerrainType;
  scale: string;
  contour_interval: number;
  created_year: number;
  updated_year?: number;
  creator: string;
  image_url: string;
  thumbnail_url: string;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  center: { lat: number; lng: number };
  tags: string[];
  description?: string;
}
