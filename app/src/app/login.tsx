import { useRouter } from "expo-router";
import { EmailLogin } from "../components/EmailLogin";

export default function Login() {
  const router = useRouter();
  return <EmailLogin role="visitor" onDone={() => router.back()} />;
}
