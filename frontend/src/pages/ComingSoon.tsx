export default function ComingSoon({ title }: { title: string }) {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500">This section hasn't been built yet.</p>
    </div>
  );
}
