import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface CreditInfo {
  balance: number;
  monthlyUsed: number;
  maxMonthly: number;
  tier: string;
  isAdmin: boolean;
  dailyGiven: number;
}

export function useCredits() {
  const { toast } = useToast();

  const { data: credits, isLoading, refetch } = useQuery<CreditInfo>({
    queryKey: ["/api/credits"],
    staleTime: 30000,
    retry: false,
  });

  const deductMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await apiRequest("POST", "/api/credits/deduct", { amount });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Insufficient credits");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Out of Credits",
        description: err.message + " — Top up to continue.",
        variant: "destructive",
      });
    },
  });

  const topupMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await apiRequest("POST", "/api/credits/topup", { amount });
      const data = await res.json();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      }
      return data;
    },
    onError: () => {
      toast({ title: "Top-up failed", description: "Please try again.", variant: "destructive" });
    },
  });

  const hasEnough = (amount: number) => {
    if (!credits) return true;
    if (credits.isAdmin) return true;
    return credits.balance >= amount;
  };

  const deduct = async (amount = 1): Promise<boolean> => {
    if (!credits || credits.isAdmin) return true;
    if (credits.balance < amount) {
      toast({
        title: "Out of Credits",
        description: `You need ${amount} credit${amount > 1 ? 's' : ''}. Top up to continue.`,
        variant: "destructive",
      });
      return false;
    }
    try {
      await deductMutation.mutateAsync(amount);
      return true;
    } catch {
      return false;
    }
  };

  return {
    credits,
    isLoading,
    refetch,
    hasEnough,
    deduct,
    topup: (amount: number) => topupMutation.mutate(amount),
    isTopupPending: topupMutation.isPending,
  };
}
