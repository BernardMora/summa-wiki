import { redirect } from "next/navigation";

/**
 * The category index moved onto the portada — it is the first thing you come
 * to the wiki for, and a second page for it just added a click. This route
 * stays as a redirect so old tabs and bookmarks still land somewhere.
 */
export default function Categories() {
  redirect("/#categorias");
}
