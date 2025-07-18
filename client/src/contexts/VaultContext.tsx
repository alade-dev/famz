import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useAccount } from "wagmi";
import { useSecureStorage } from "@/lib/secureStorage";

interface VaultPosition {
  id: string;
  vaultName: string;
  wbtcDeposited: number;
  stcoreDeposited: number;
  lstbtcGenerated: number;
  depositDate: string;
  initialValue: number; // Store the initial deposit value separately
  currentValue: number;
  earnings: number;
  apy: string;
  wbtcEarnings: number; // Earnings in wBTC from lstBTC
  stcoreEarnings: number; // Earnings in stCORE from lstBTC
  lastEarningsUpdate: string; // Track when earnings were last calculated
}

interface EarningsHistory {
  id: string;
  vaultId: string;
  date: string;
  wbtcEarned: number;
  stcoreEarned: number;
  lstbtcValue: number;
}

interface VaultContextType {
  positions: VaultPosition[];
  addPosition: (
    position: Omit<
      VaultPosition,
      | "id"
      | "depositDate"
      | "earnings"
      | "wbtcEarnings"
      | "stcoreEarnings"
      | "initialValue"
      | "lastEarningsUpdate"
    >
  ) => void;
  updateEarnings: () => void;
  getTotalDeposited: () => number;
  getTotalEarnings: () => number;
  getTotalValue: () => number;
  userBalances: { wbtc: number; stcore: number };
  setUserBalances: React.Dispatch<
    React.SetStateAction<{ wbtc: number; stcore: number }>
  >;
  closeVault: (id: string) => void;
  earningsHistory: EarningsHistory[];
  getTotalWbtcEarnings: () => number;
  getTotalStcoreEarnings: () => number;
  isWalletConnected: boolean;
  isDataLoaded: boolean;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isConnected, address } = useAccount();
  const { getSecureItem, setSecureItem, isWalletConnected } =
    useSecureStorage();

  const [positions, setPositions] = useState<VaultPosition[]>([]);
  const [userBalances, setUserBalances] = useState<{
    wbtc: number;
    stcore: number;
  }>({ wbtc: 0, stcore: 0 });
  const [earningsHistory, setEarningsHistory] = useState<EarningsHistory[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // Use ref to track if we're currently updating earnings to prevent loops
  const isUpdatingEarnings = useRef(false);
  const lastUpdateTime = useRef<number>(0);

  // Define expected data structures for validation
  const expectedVaultPosition: VaultPosition = {
    id: "",
    vaultName: "",
    wbtcDeposited: 0,
    stcoreDeposited: 0,
    lstbtcGenerated: 0,
    depositDate: "",
    initialValue: 0,
    currentValue: 0,
    earnings: 0,
    apy: "",
    wbtcEarnings: 0,
    stcoreEarnings: 0,
    lastEarningsUpdate: "",
  };

  const expectedEarningsHistory: EarningsHistory = {
    id: "",
    vaultId: "",
    date: "",
    wbtcEarned: 0,
    stcoreEarned: 0,
    lstbtcValue: 0,
  };

  const expectedUserBalances = { wbtc: 0, stcore: 0 };

  // Memoized updateEarnings function to prevent infinite loops
  const updateEarnings = useCallback(() => {
    if (!isConnected || !isDataLoaded) return;

    // Prevent multiple simultaneous updates
    if (isUpdatingEarnings.current) return;

    // Only update if at least 5 minutes have passed since last update
    const now = Date.now();
    if (now - lastUpdateTime.current < 5 * 60 * 1000) return;

    isUpdatingEarnings.current = true;
    lastUpdateTime.current = now;

    setPositions((currentPositions) => {
      const updatedPositions = currentPositions.map((position) => {
        const depositDate = new Date(position.depositDate);
        const currentTime = new Date();

        // Round to nearest hour to prevent micro-fluctuations
        const hoursElapsed = Math.floor(
          (currentTime.getTime() - depositDate.getTime()) / (1000 * 60 * 60)
        );
        const daysSinceDeposit = hoursElapsed / 24;

        // Calculate earnings based on APY using initial value (not current value)
        const apyNumber = parseFloat(position.apy.replace("%", ""));
        const dailyRate = apyNumber / 365 / 100;
        const initialValue =
          position.initialValue ||
          position.wbtcDeposited * 43000 + position.stcoreDeposited;

        // Round earnings to prevent micro-fluctuations
        const totalEarnings =
          Math.round(initialValue * dailyRate * daysSinceDeposit * 100) / 100;

        // Calculate proportional earnings for wBTC and stCORE based on lstBTC
        const originalDeposit =
          position.wbtcDeposited * 43000 + position.stcoreDeposited;
        const wbtcProportion =
          (position.wbtcDeposited * 43000) / originalDeposit;
        const stcoreProportion = position.stcoreDeposited / originalDeposit;

        // Convert lstBTC earnings to wBTC and stCORE equivalents with rounding
        const lstbtcEarnings =
          position.lstbtcGenerated * dailyRate * daysSinceDeposit;
        const wbtcEarnings =
          Math.round(lstbtcEarnings * wbtcProportion * 1000000) / 1000000; // Round to 6 decimals
        const stcoreEarnings =
          Math.round(lstbtcEarnings * stcoreProportion * 43000 * 100) / 100; // Round to 2 decimals

        // Only update if values have actually changed significantly
        const hasSignificantChange =
          Math.abs(position.earnings - totalEarnings) > 0.01 ||
          Math.abs(position.wbtcEarnings - wbtcEarnings) > 0.000001 ||
          Math.abs(position.stcoreEarnings - stcoreEarnings) > 0.01;

        if (!hasSignificantChange) {
          return position; // Return unchanged position to prevent unnecessary updates
        }

        return {
          ...position,
          initialValue, // Ensure we have the initial value stored
          earnings: Math.max(0, totalEarnings),
          wbtcEarnings: Math.max(0, wbtcEarnings),
          stcoreEarnings: Math.max(0, stcoreEarnings),
          currentValue: Math.round((initialValue + totalEarnings) * 100) / 100, // Round current value
          lastEarningsUpdate: currentTime.toISOString(),
        };
      });

      isUpdatingEarnings.current = false;
      return updatedPositions;
    });
  }, [isConnected, isDataLoaded]);

  // Load data when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      // First, attempt to migrate any existing unsecured data
      const migrateOldData = () => {
        const oldKeys = ["vaultPositions", "userBalances", "earningsHistory"];
        let migrated = false;

        oldKeys.forEach((key) => {
          const oldData = localStorage.getItem(key);
          if (oldData) {
            try {
              const parsedData = JSON.parse(oldData);
              setSecureItem(key, parsedData);
              localStorage.removeItem(key); // Remove old unsecured data
              migrated = true;
            } catch (error) {
              console.error(`Failed to migrate ${key}:`, error);
            }
          }
        });

        return migrated;
      };

      // Migrate old data if it exists
      const wasMigrated = migrateOldData();

      // Load positions with validation
      const loadedPositions = getSecureItem<VaultPosition[]>(
        "vaultPositions",
        [],
        [expectedVaultPosition]
      );

      // Load balances with validation
      const loadedBalances = getSecureItem(
        "userBalances",
        { wbtc: 1.0, stcore: 10000 }, // Default balances for new users
        expectedUserBalances
      );

      // Load earnings history with validation
      const loadedEarningsHistory = getSecureItem<EarningsHistory[]>(
        "earningsHistory",
        [],
        [expectedEarningsHistory]
      );

      setPositions(loadedPositions);
      setUserBalances(loadedBalances);
      setEarningsHistory(loadedEarningsHistory);
      setIsDataLoaded(true);

      // Show migration success message if data was migrated
      if (wasMigrated) {
        console.log("Successfully migrated data to secure storage");
      }
    } else {
      // Clear data when wallet disconnects
      setPositions([]);
      setUserBalances({ wbtc: 0, stcore: 0 });
      setEarningsHistory([]);
      setIsDataLoaded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  // Save positions to secure storage whenever they change (only if wallet connected)
  // Use a separate effect with debouncing to prevent excessive saves
  useEffect(() => {
    if (isConnected && address && isDataLoaded && !isUpdatingEarnings.current) {
      const timeoutId = setTimeout(() => {
        setSecureItem("vaultPositions", positions);
      }, 1000); // Debounce saves by 1 second

      return () => clearTimeout(timeoutId);
    }
  }, [positions, isConnected, address, isDataLoaded, setSecureItem]);

  // Save balances to secure storage whenever they change (only if wallet connected)
  useEffect(() => {
    if (isConnected && address && isDataLoaded) {
      const timeoutId = setTimeout(() => {
        setSecureItem("userBalances", userBalances);
      }, 1000); // Debounce saves by 1 second

      return () => clearTimeout(timeoutId);
    }
  }, [userBalances, isConnected, address, isDataLoaded, setSecureItem]);

  // Save earnings history to secure storage whenever it changes (only if wallet connected)
  useEffect(() => {
    if (isConnected && address && isDataLoaded) {
      const timeoutId = setTimeout(() => {
        setSecureItem("earningsHistory", earningsHistory);
      }, 1000); // Debounce saves by 1 second

      return () => clearTimeout(timeoutId);
    }
  }, [earningsHistory, isConnected, address, isDataLoaded, setSecureItem]);

  // Update earnings every 15 minutes (only if wallet connected) - further reduced frequency for stability
  useEffect(() => {
    if (isConnected && isDataLoaded) {
      // Initial update after a short delay to prevent immediate loops
      const initialTimeout = setTimeout(() => {
        updateEarnings();
      }, 2000);

      const interval = setInterval(updateEarnings, 15 * 60 * 1000); // 15 minutes

      return () => {
        clearTimeout(initialTimeout);
        clearInterval(interval);
      };
    }
  }, [isConnected, isDataLoaded, updateEarnings]);

  const addPosition = useCallback(
    (
      positionData: Omit<
        VaultPosition,
        | "id"
        | "depositDate"
        | "earnings"
        | "wbtcEarnings"
        | "stcoreEarnings"
        | "initialValue"
        | "lastEarningsUpdate"
      >
    ) => {
      if (!isConnected || !isDataLoaded) {
        console.warn(
          "Cannot add position: wallet not connected or data not loaded"
        );
        return;
      }

      const initialValue =
        positionData.wbtcDeposited * 43000 + positionData.stcoreDeposited;
      const newPosition: VaultPosition = {
        ...positionData,
        id: Date.now().toString(),
        depositDate: new Date().toISOString(),
        initialValue,
        earnings: 0,
        wbtcEarnings: 0,
        stcoreEarnings: 0,
        lastEarningsUpdate: new Date().toISOString(),
      };

      setPositions((prev) => [...prev, newPosition]);
    },
    [isConnected, isDataLoaded]
  );

  const getTotalWbtcEarnings = useCallback(() => {
    if (!isConnected || !isDataLoaded) return 0;
    return positions.reduce(
      (total, position) => total + position.wbtcEarnings,
      0
    );
  }, [isConnected, isDataLoaded, positions]);

  const getTotalStcoreEarnings = useCallback(() => {
    if (!isConnected || !isDataLoaded) return 0;
    return positions.reduce(
      (total, position) => total + position.stcoreEarnings,
      0
    );
  }, [isConnected, isDataLoaded, positions]);

  const getTotalDeposited = useCallback(() => {
    if (!isConnected || !isDataLoaded) return 0;
    return positions.reduce(
      (total, position) => total + position.currentValue - position.earnings,
      0
    );
  }, [isConnected, isDataLoaded, positions]);

  const getTotalEarnings = useCallback(() => {
    if (!isConnected || !isDataLoaded) return 0;
    return positions.reduce((total, position) => total + position.earnings, 0);
  }, [isConnected, isDataLoaded, positions]);

  const getTotalValue = useCallback(() => {
    if (!isConnected || !isDataLoaded) return 0;
    return positions.reduce(
      (total, position) => total + position.currentValue,
      0
    );
  }, [isConnected, isDataLoaded, positions]);

  const closeVault = useCallback(
    (id: string) => {
      if (!isConnected || !isDataLoaded) {
        console.warn(
          "Cannot close vault: wallet not connected or data not loaded"
        );
        return;
      }

      setPositions((prev) => {
        const pos = prev.find((p) => p.id === id);
        if (!pos) return prev;

        // Add earnings to history
        const earningRecord: EarningsHistory = {
          id: Date.now().toString(),
          vaultId: pos.id,
          date: new Date().toISOString(),
          wbtcEarned: pos.wbtcEarnings,
          stcoreEarned: pos.stcoreEarnings,
          lstbtcValue: pos.lstbtcGenerated,
        };
        setEarningsHistory((prev) => [...prev, earningRecord]);

        // Credit user with original deposits plus earnings from lstBTC
        setUserBalances((bal) => ({
          wbtc: bal.wbtc + pos.wbtcDeposited + pos.wbtcEarnings,
          stcore: bal.stcore + pos.stcoreDeposited + pos.stcoreEarnings,
        }));

        return prev.filter((p) => p.id !== id);
      });
    },
    [isConnected, isDataLoaded]
  );

  return (
    <VaultContext.Provider
      value={{
        positions,
        addPosition,
        updateEarnings,
        getTotalDeposited,
        getTotalEarnings,
        getTotalValue,
        userBalances,
        setUserBalances,
        closeVault,
        earningsHistory,
        getTotalWbtcEarnings,
        getTotalStcoreEarnings,
        isWalletConnected,
        isDataLoaded,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
};

export const useVault = () => {
  const context = useContext(VaultContext);
  if (context === undefined) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
};
