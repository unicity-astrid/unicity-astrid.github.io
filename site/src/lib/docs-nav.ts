/** Shared navigation shape for the chaptered developer guide. */
export interface NavItem {
  title: string;
  slug: string;
}

export interface NavGroup {
  part: string | null;
  items: NavItem[];
}
