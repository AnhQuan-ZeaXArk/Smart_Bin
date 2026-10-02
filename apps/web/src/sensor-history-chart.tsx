import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type SensorReading = {
  id: string;
  fillLevel: number;
  distance: number;
  timestamp: string;
};

export default function SensorHistoryChart({ readings }: { readings: SensorReading[] }) {
  const chartReadings = [...readings].reverse().map((reading) => ({
    ...reading,
    timeLabel: new Date(reading.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartReadings} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
        <defs><linearGradient id="fillLevelGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient></defs>
        <CartesianGrid stroke="#26394b" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="timeLabel" tick={{ fill: '#91a4b7', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fill: '#91a4b7', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ background: '#132235', border: '1px solid #2d4358', borderRadius: 6, color: '#f8fafc' }} formatter={(value) => [`${value}%`, 'Mức đầy']} />
        <Area type="monotone" dataKey="fillLevel" stroke="#10b981" strokeWidth={2} fill="url(#fillLevelGradient)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}