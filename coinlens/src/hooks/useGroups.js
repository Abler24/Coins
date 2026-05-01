import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'coinlens_groups_v1';
const ACTIVE_KEY = 'coinlens_active_group_v1';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadActive() {
  try {
    return localStorage.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}

function makeId() {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function coinSnapshot(coin) {
  return {
    objectid: coin.objectid,
    title: coin.title || 'Untitled',
    culture: coin.culture || '',
    dated: coin.dated || '',
    medium: coin.medium || '',
    primaryimageurl: coin.primaryimageurl || '',
  };
}

export function useGroups() {
  const [groups, setGroups] = useState(() => loadFromStorage());
  const [activeGroupId, setActiveGroupIdState] = useState(() => loadActive());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
    } catch {
      // ignore quota
    }
  }, [groups]);

  useEffect(() => {
    try {
      if (activeGroupId) localStorage.setItem(ACTIVE_KEY, activeGroupId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // ignore
    }
  }, [activeGroupId]);

  const createGroup = useCallback((name) => {
    const group = {
      id: makeId(),
      name: (name || 'Untitled group').trim() || 'Untitled group',
      coinIds: [],
      coinsById: {},
      createdAt: Date.now(),
    };
    setGroups((prev) => [...prev, group]);
    setActiveGroupIdState(group.id);
    return group;
  }, []);

  const deleteGroup = useCallback((id) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setActiveGroupIdState((curr) => (curr === id ? null : curr));
  }, []);

  const renameGroup = useCallback((id, name) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name } : g)),
    );
  }, []);

  const addCoinToGroup = useCallback((groupId, coin) => {
    if (!groupId || !coin) return;
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        if (g.coinIds.includes(coin.objectid)) return g;
        return {
          ...g,
          coinIds: [...g.coinIds, coin.objectid],
          coinsById: { ...g.coinsById, [coin.objectid]: coinSnapshot(coin) },
        };
      }),
    );
  }, []);

  const addCoinsToGroup = useCallback((groupId, coins) => {
    if (!groupId || !coins?.length) return;
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const nextIds = [...g.coinIds];
        const nextMap = { ...g.coinsById };
        coins.forEach((c) => {
          if (!nextIds.includes(c.objectid)) {
            nextIds.push(c.objectid);
            nextMap[c.objectid] = coinSnapshot(c);
          }
        });
        return { ...g, coinIds: nextIds, coinsById: nextMap };
      }),
    );
  }, []);

  const removeCoinFromGroup = useCallback((groupId, coinId) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const nextMap = { ...g.coinsById };
        delete nextMap[coinId];
        return {
          ...g,
          coinIds: g.coinIds.filter((id) => id !== coinId),
          coinsById: nextMap,
        };
      }),
    );
  }, []);

  const setActiveGroup = useCallback((id) => {
    setActiveGroupIdState(id);
  }, []);

  return {
    groups,
    activeGroupId,
    activeGroup: groups.find((g) => g.id === activeGroupId) || null,
    createGroup,
    deleteGroup,
    renameGroup,
    addCoinToGroup,
    addCoinsToGroup,
    removeCoinFromGroup,
    setActiveGroup,
  };
}
