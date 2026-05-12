import ProjectsHomePage from "@/components/ProjectsHomePage";
import { requireAdminPageAuth } from "@/lib/auth/session";

export default async function Home() {
  await requireAdminPageAuth("/");
  return <ProjectsHomePage />;
}
