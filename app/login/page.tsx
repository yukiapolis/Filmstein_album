import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getAuthenticatedAdminUser } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

function normalizeNextPath(nextPath: string | undefined) {
  if (!nextPath || !nextPath.startsWith("/")) return "/";
  if (nextPath.startsWith("//")) return "/";
  return nextPath;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const adminUser = await getAuthenticatedAdminUser();
  const { next } = await searchParams;
  const nextPath = normalizeNextPath(next);

  if (adminUser) {
    redirect(nextPath);
  }

  return <LoginForm nextPath={nextPath} />;
}
