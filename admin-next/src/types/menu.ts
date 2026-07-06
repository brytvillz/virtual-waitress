export type Category = {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  ada_message: string;
  sort_order: number;
  restaurant_id: string;
};

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  description: string;
  ada_message: string;
  image_url: string | null;
  available: boolean;
  category_id: string;
  restaurant_id: string;
  sort_order: number;
};
