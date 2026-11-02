import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Strategy,
  StrategyBlock,
  StrategyConnection,
  PageId,
} from '../../types/trading';
import { PREBUILT_STRATEGIES } from '../../data/prebuiltStrategies';
import { storage } from '../../services/storage';
import { audioEffects } from '../../services/audioEffects';
import { useToast } from '../common/ToastNotification';
import { BlockNode } from './BlockNode';
import { BlockPalette } from './BlockPalette';
import { ValidationPanel, validateStrategy } from './ValidationPanel';
import {
  Save,
  Play,
  FlaskConical,
  Download,
  Upload,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Sliders,
} from 'lucide-react';

interface StrategyBuilderProps {
  onNavigate: (page: PageId) => void;
  onRunStrategyInDemo: (strategy: Strategy) => void;
  onBacktestStrategy: (strategy: Strategy) => void;
  currentStrategy?: Strategy | null;
}

export const StrategyBuilder: React.FC<StrategyBuilderProps> = ({
  onNavigate,
  onRunStrategyInDemo,
  onBacktestStrategy,
  currentStrategy,
}) => {
  const { showToast } = useToast();

  const [activeStrategy, setActiveStrategy] = useState<Strategy>(() => {
    return currentStrategy || PREBUILT_STRATEGIES[0];
  });

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Connection dragging state
  const [pendingConnection, setPendingConnection] = useState<{
    fromBlockId: string;
    fromPortId: string;
  } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Block dragging state
  const [draggingBlock, setDraggingBlock] = useState<{
    id: string;
    startX: number;
    startY: number;
    blockStartX: number;
    blockStartY: number;
  } | null>(null);

  const [showValidation, setShowValidation] = useState<boolean>(true);
  const [showTemplatesModal, setShowTemplatesModal] = useState<boolean>(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentStrategy) {
      setActiveStrategy(currentStrategy);
    }
  }, [currentStrategy]);

  // Set of connected ports for visual indicator
  const connectedPorts = useMemo(() => {
    const set = new Set<string>();
    activeStrategy.connections.forEach((c) => {
      set.add(`${c.fromBlockId}:${c.fromPortId}`);
      set.add(`${c.toBlockId}:${c.toPortId}`);
    });
    return set;
  }, [activeStrategy.connections]);

  const validationIssues = useMemo(() => {
    return validateStrategy(activeStrategy);
  }, [activeStrategy]);

  const hasErrors = validationIssues.some((i) => i.severity === 'error');

  // Add block from palette
  const handleAddBlock = (template: any) => {
    const newId = `b_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    // Center block in current viewport
    const newBlock: StrategyBlock = {
      id: newId,
      type: template.type,
      category: template.category,
      title: template.title,
      position: {
        x: Math.round(-pan.x + 200 + Math.random() * 80),
        y: Math.round(-pan.y + 160 + Math.random() * 80),
      },
      params: { ...template.defaultParams },
      inputs: [...template.inputs],
      outputs: [...template.outputs],
    };

    setActiveStrategy((prev) => ({
      ...prev,
      blocks: [...prev.blocks, newBlock],
    }));

    setSelectedBlockId(newId);
    audioEffects.playTick();
    showToast('info', 'Block Added', `Added "${template.title}" onto canvas`);
  };

  // Duplicate block
  const handleDuplicateBlock = (blockId: string) => {
    const target = activeStrategy.blocks.find((b) => b.id === blockId);
    if (!target) return;

    const dupId = `b_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    const duplicated: StrategyBlock = {
      ...target,
      id: dupId,
      title: `${target.title} (Copy)`,
      position: { x: target.position.x + 30, y: target.position.y + 30 },
      params: { ...target.params },
    };

    setActiveStrategy((prev) => ({
      ...prev,
      blocks: [...prev.blocks, duplicated],
    }));

    setSelectedBlockId(dupId);
    audioEffects.playTick();
  };

  // Delete block
  const handleDeleteBlock = (blockId: string) => {
    setActiveStrategy((prev) => ({
      ...prev,
      blocks: prev.blocks.filter((b) => b.id !== blockId),
      connections: prev.connections.filter(
        (c) => c.fromBlockId !== blockId && c.toBlockId !== blockId
      ),
    }));
    if (selectedBlockId === blockId) setSelectedBlockId(null);
  };

  // Update parameters
  const handleUpdateParams = (blockId: string, newParams: Record<string, any>) => {
    setActiveStrategy((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, params: newParams } : b)),
    }));
  };

  // Start connecting from output
  const handleStartConnect = (blockId: string, portId: string, isOutput: boolean) => {
    if (!isOutput) return;
    setPendingConnection({ fromBlockId: blockId, fromPortId: portId });
  };

  // End connect at input
  const handleEndConnect = (blockId: string, portId: string, isOutput: boolean) => {
    if (isOutput || !pendingConnection) return;
    if (pendingConnection.fromBlockId === blockId) {
      // Don't connect block to itself
      setPendingConnection(null);
      return;
    }

    const newConnection: StrategyConnection = {
      id: `c_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      fromBlockId: pendingConnection.fromBlockId,
      fromPortId: pendingConnection.fromPortId,
      toBlockId: blockId,
      toPortId: portId,
    };

    // Prevent duplicate connection
    const exists = activeStrategy.connections.some(
      (c) =>
        c.fromBlockId === newConnection.fromBlockId &&
        c.fromPortId === newConnection.fromPortId &&
        c.toBlockId === newConnection.toBlockId &&
        c.toPortId === newConnection.toPortId
    );

    if (!exists) {
      setActiveStrategy((prev) => ({
        ...prev,
        connections: [...prev.connections, newConnection],
      }));
      audioEffects.playTick();
      showToast('success', 'Blocks Linked', 'Connection successfully routed.');
    }

    setPendingConnection(null);
  };

  // Delete connection wire
  const handleDeleteConnection = (connId: string) => {
    setActiveStrategy((prev) => ({
      ...prev,
      connections: prev.connections.filter((c) => c.id !== connId),
    }));
    audioEffects.playTick();
  };

  // Canvas pan / drag handlers
  const handleMouseDownCanvas = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).tagName === 'svg') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      setSelectedBlockId(null);
      setPendingConnection(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setMousePos({
        x: (e.clientX - rect.left - pan.x) / zoom,
        y: (e.clientY - rect.top - pan.y) / zoom,
      });
    }

    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    } else if (draggingBlock) {
      const dx = (e.clientX - draggingBlock.startX) / zoom;
      const dy = (e.clientY - draggingBlock.startY) / zoom;

      setActiveStrategy((prev) => ({
        ...prev,
        blocks: prev.blocks.map((b) =>
          b.id === draggingBlock.id
            ? {
                ...b,
                position: {
                  x: Math.round(draggingBlock.blockStartX + dx),
                  y: Math.round(draggingBlock.blockStartY + dy),
                },
              }
            : b
        ),
      }));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingBlock(null);
  };

  const handleDragBlockStart = (e: React.MouseEvent, blockId: string) => {
    e.stopPropagation();
    const block = activeStrategy.blocks.find((b) => b.id === blockId);
    if (!block) return;
    setSelectedBlockId(blockId);
    setDraggingBlock({
      id: blockId,
      startX: e.clientX,
      startY: e.clientY,
      blockStartX: block.position.x,
      blockStartY: block.position.y,
    });
  };

  // Save strategy
  const handleSaveStrategy = () => {
    const updated = { ...activeStrategy, updatedAt: Date.now() };
    storage.saveStrategy(updated);
    setActiveStrategy(updated);
    audioEffects.playTradePlaced();
    showToast('success', 'Strategy Saved', `"${activeStrategy.name}" saved to library.`);
  };

  // Export JSON
  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(activeStrategy, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeStrategy.name.toLowerCase().replace(/\s+/g, '_')}_strategy.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Strategy Exported', 'JSON downloaded to your device.');
  };

  // Import JSON
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.blocks && parsed.connections) {
          setActiveStrategy({
            ...parsed,
            id: `strat_${Date.now()}`,
            name: `${parsed.name || 'Imported'} (Imported)`,
          });
          showToast('success', 'Strategy Imported', 'Loaded block configuration.');
        } else {
          showToast('error', 'Invalid File', 'JSON does not contain valid strategy schema.');
        }
      } catch (err) {
        showToast('error', 'Parse Error', 'Failed to read strategy JSON file.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Reset to default
  const handleResetCanvas = () => {
    if (confirm('Reset canvas to default template? Unsaved changes will be lost.')) {
      setActiveStrategy(PREBUILT_STRATEGIES[0]);
      setPan({ x: 0, y: 0 });
      setZoom(1);
      showToast('info', 'Canvas Reset', 'Restored RSI Reversal template.');
    }
  };

  // Calculate coordinates for connection line
  const getPortCoords = (blockId: string, portId: string, isOutput: boolean) => {
    const block = activeStrategy.blocks.find((b) => b.id === blockId);
    if (!block) return { x: 0, y: 0 };

    const portList = isOutput ? block.outputs : block.inputs;
    const portIndex = portList.findIndex((p) => p.id === portId);
    const validIndex = portIndex >= 0 ? portIndex : 0;

    // Approximate port position relative to block (width 256px)
    const blockX = block.position.x;
    const blockY = block.position.y;
    const headerHeight = 42;
    const paramsApproxHeight = 70;
    const portY = blockY + headerHeight + paramsApproxHeight + validIndex * 24 + 14;

    const portX = isOutput ? blockX + 256 : blockX;
    return { x: portX, y: portY };
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-[#070B12] select-none overflow-hidden">
      {/* Top Builder Toolbar */}
      <div className="bg-[#090D16] border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs z-20">
        {/* Strategy Title & Market Indicator */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={activeStrategy.name}
            onChange={(e) => setActiveStrategy((prev) => ({ ...prev, name: e.target.value }))}
            className="bg-transparent font-bold text-slate-100 hover:bg-slate-800/60 focus:bg-slate-800 rounded px-2 py-1 border border-transparent focus:border-cyan-500 focus:outline-none transition-colors"
          />

          {/* Validation Status Pill */}
          <div
            onClick={() => setShowValidation(!showValidation)}
            className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
              hasErrors
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            }`}
          >
            {hasErrors ? (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                <span>{validationIssues.length} Incomplete</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Strategy Verified</span>
              </>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-md p-0.5">
            <button
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono text-[10px] text-slate-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
              title="Reset View"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Templates Modal Button */}
          <button
            onClick={() => setShowTemplatesModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors border border-slate-700/60 font-medium"
          >
            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
            <span>Templates</span>
          </button>

          {/* Save */}
          <button
            onClick={handleSaveStrategy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors border border-slate-700/60 font-medium"
          >
            <Save className="w-3.5 h-3.5 text-emerald-400" />
            <span>Save</span>
          </button>

          {/* Export / Import */}
          <button
            onClick={handleExportJSON}
            title="Export Strategy JSON"
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700/60"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <label
            title="Import Strategy JSON"
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700/60 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportJSON}
              className="hidden"
            />
          </label>

          {/* Reset */}
          <button
            onClick={handleResetCanvas}
            title="Clear and Reset Canvas"
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700/60"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-800 mx-1" />

          {/* Backtest Button */}
          <button
            onClick={() => onBacktestStrategy(activeStrategy)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-lg font-semibold transition-colors"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>Backtest</span>
          </button>

          {/* Run in Demo Trader Button */}
          <button
            onClick={() => onRunStrategyInDemo(activeStrategy)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg transition-colors shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Deploy to Demo</span>
          </button>
        </div>
      </div>

      {/* Main Workspace (Left Palette + Center Canvas) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Block Palette */}
        <BlockPalette onAddBlock={handleAddBlock} />

        {/* 2D Canvas Workspace */}
        <div
          ref={canvasRef}
          onMouseDown={handleMouseDownCanvas}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="flex-1 relative overflow-hidden strategy-canvas-grid cursor-grab active:cursor-grabbing bg-[#070B12]"
        >
          {/* Zoom and Pan Layer */}
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
            className="w-full h-full absolute inset-0 pointer-events-none"
          >
            {/* SVG Connector Wires Layer */}
            <svg
              className="absolute inset-0 w-[5000px] h-[5000px] pointer-events-auto"
              style={{ overflow: 'visible' }}
            >
              {/* Existing Connections */}
              {activeStrategy.connections.map((conn) => {
                const fromCoords = getPortCoords(conn.fromBlockId, conn.fromPortId, true);
                const toCoords = getPortCoords(conn.toBlockId, conn.toPortId, false);

                const dx = Math.abs(toCoords.x - fromCoords.x) * 0.5;
                const pathData = `M ${fromCoords.x} ${fromCoords.y} C ${fromCoords.x + dx} ${
                  fromCoords.y
                }, ${toCoords.x - dx} ${toCoords.y}, ${toCoords.x} ${toCoords.y}`;

                return (
                  <g key={conn.id} className="group cursor-pointer">
                    {/* Wider transparent hit zone */}
                    <path
                      d={pathData}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="14"
                      onClick={() => handleDeleteConnection(conn.id)}
                    />
                    {/* Visible line */}
                    <path
                      d={pathData}
                      fill="none"
                      stroke="#06B6D4"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="group-hover:stroke-rose-400 transition-colors"
                    />
                  </g>
                );
              })}

              {/* Wire being actively dragged */}
              {pendingConnection && (
                (() => {
                  const fromCoords = getPortCoords(
                    pendingConnection.fromBlockId,
                    pendingConnection.fromPortId,
                    true
                  );
                  const dx = Math.abs(mousePos.x - fromCoords.x) * 0.5;
                  const pathData = `M ${fromCoords.x} ${fromCoords.y} C ${
                    fromCoords.x + dx
                  } ${fromCoords.y}, ${mousePos.x - dx} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`;

                  return (
                    <path
                      d={pathData}
                      fill="none"
                      stroke="#10B981"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                    />
                  );
                })()
              )}
            </svg>

            {/* Strategy Blocks Layer */}
            <div className="pointer-events-auto">
              {activeStrategy.blocks.map((block) => (
                <BlockNode
                  key={block.id}
                  block={block}
                  isSelected={selectedBlockId === block.id}
                  onSelect={() => setSelectedBlockId(block.id)}
                  onUpdateParams={handleUpdateParams}
                  onDelete={handleDeleteBlock}
                  onDuplicate={handleDuplicateBlock}
                  onStartConnect={handleStartConnect}
                  onEndConnect={handleEndConnect}
                  connectedPorts={connectedPorts}
                  onDragStart={handleDragBlockStart}
                />
              ))}
            </div>
          </div>

          {/* Validation Drawer Overlay in Bottom-Right */}
          {showValidation && (
            <div className="absolute bottom-4 right-4 z-30 max-w-sm w-full shadow-2xl">
              <ValidationPanel
                strategy={activeStrategy}
                onSelectBlock={(bId) => {
                  setSelectedBlockId(bId);
                  const target = activeStrategy.blocks.find((b) => b.id === bId);
                  if (target) {
                    setPan({
                      x: -target.position.x + 300,
                      y: -target.position.y + 200,
                    });
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Prebuilt Templates Modal */}
      {showTemplatesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0D1322] border border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <h3 className="font-semibold text-slate-100 text-sm">
              Pre-built Verified Trading Strategy Templates
            </h3>
            <p className="text-xs text-slate-400">
              Load an institutional template into your canvas workspace. You can edit any parameter or connection.
            </p>

            <div className="space-y-2.5 max-h-72 overflow-y-auto">
              {PREBUILT_STRATEGIES.map((strat) => (
                <div
                  key={strat.id}
                  onClick={() => {
                    setActiveStrategy(strat);
                    setShowTemplatesModal(false);
                    showToast('success', 'Template Loaded', `Loaded "${strat.name}"`);
                  }}
                  className="p-3 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 rounded-lg cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-slate-200">{strat.name}</span>
                    <span className="font-mono text-[10px] text-cyan-400">{strat.marketSymbol}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{strat.description}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowTemplatesModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
