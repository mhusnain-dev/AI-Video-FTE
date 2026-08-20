import { SparklesIcon } from '@heroicons/react/24/outline';
import { useChatStore, type LLMProvider } from '../store/chatStore';

export function TemperatureSlider() {
  const { temperature, setTemperature, selectedModel, setSelectedModel } = useChatStore();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
            <SparklesIcon className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">FTE LLM Provider</h3>
            <p className="text-sm text-gray-500">Controls which model generates FTE responses</p>
          </div>
        </div>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value as LLMProvider)}
          className="px-3 py-1 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
        >
          <option value="gemini">Gemini 3.5 Flash</option>
          <option value="nvidia">Nemotron 3 Ultra 550B</option>
        </select>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
            <SparklesIcon className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">
              {selectedModel === 'nvidia' ? 'Nemotron 3 Ultra 550B' : 'Gemini 3.5 Flash'} Temperature
            </h3>
            <p className="text-sm text-gray-500">Controls creativity of FTE responses</p>
          </div>
        </div>
        <span className="px-3 py-1 text-sm font-mono bg-purple-50 text-purple-700 rounded-full">
          {temperature.toFixed(1)}
        </span>
      </div>

      <div className="space-y-2">
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={temperature}
          onChange={(e) => setTemperature(parseFloat(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>0.0 (Focused)</span>
          <span>0.5 (Balanced)</span>
          <span>1.0 (Creative)</span>
        </div>

        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">
            <strong>Current: </strong>
            {temperature <= 0.3 ? 'Focused - Precise, consistent responses' :
             temperature <= 0.6 ? 'Balanced - Good mix of precision and creativity' :
             'Creative - More varied, exploratory responses'}
          </p>
        </div>
      </div>
    </div>
  );
}
