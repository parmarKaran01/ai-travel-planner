import { ChatInterface } from "@/components/chat-interface";


export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-4 bg-background">
      <ChatInterface />
    </main>
  );
}
