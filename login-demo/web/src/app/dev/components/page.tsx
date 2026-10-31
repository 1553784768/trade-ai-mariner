import { notFound } from "next/navigation";
import Gallery from "./gallery";
export default function Page() {
  if (process.env.NODE_ENV !== "development" && process.env.NEXT_PUBLIC_ENABLE_GALLERY !== "1") notFound();
  return <Gallery />;
}
