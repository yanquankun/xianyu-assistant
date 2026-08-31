export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  systemInstruction: string;
}

export interface UserPreferences {
  defaultShippingMethod: string;
  panelNavigation: 'product' | 'settings' | 'logs';
}
