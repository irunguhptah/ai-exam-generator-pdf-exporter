
"use client"
import { createAuthClient } from "better-auth/react"
import { useEffect, useState } from "react"

// Helper function to safely get token
const getToken = () => {
  if (typeof window === 'undefined') return "";
  return localStorage.getItem("bearer_token") || "";
}

export const authClient = createAuthClient({
   baseURL: typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL,
  fetchOptions: {
      onSuccess: (ctx) => {
          const authToken = ctx.response.headers.get("set-auth-token")
          // Store the token securely (e.g., in localStorage)
          if(authToken && typeof window !== 'undefined'){
            localStorage.setItem("bearer_token", authToken);
          }
      }
  }
});

type SessionData = ReturnType<typeof authClient.useSession>

export function useSession(): SessionData {
   const [session, setSession] = useState<any>(null);
   const [isPending, setIsPending] = useState(true);
   const [isRefetching, setIsRefetching] = useState(false);
   const [error, setError] = useState<any>(null);

   const refetch = () => {
      setIsPending(true);
      setIsRefetching(true);
      setError(null);
      fetchSession();
   };

   const fetchSession = async () => {
      try {
         const res = await authClient.getSession({
            fetchOptions: {
               auth: {
                  type: "Bearer",
                  token: getToken(),
               },
            },
         });
         setSession(res.data);
         setError(null);
      } catch (err) {
         setSession(null);
         setError(err);
      } finally {
         setIsPending(false);
         setIsRefetching(false);
      }
   };

   useEffect(() => {
      fetchSession();
   }, []);

   return { data: session, isPending, isRefetching, error, refetch };
}