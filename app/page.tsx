export default function Page() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-bold mb-6">Vatic Prop Trading Terminal</h1>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-400">Solid.js Application</h2>
          <p className="text-gray-300 mb-4">
            This trading terminal is built with <strong>Solid.js</strong> and requires Vite to run. The v0 preview
            environment uses Next.js, so the Solid.js app cannot run here directly.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-green-400">How to Run Locally</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-300">
            <li>Download this project using the three dots menu → "Download ZIP"</li>
            <li>Extract the ZIP file</li>
            <li>Open a terminal in the project directory</li>
            <li>
              Install dependencies: <code className="bg-black px-2 py-1 rounded">npm install</code>
            </li>
            <li>
              Start the dev server: <code className="bg-black px-2 py-1 rounded">npm run dev:solid</code>
            </li>
            <li>
              Open <code className="bg-black px-2 py-1 rounded">http://localhost:3000</code> in your browser
            </li>
          </ol>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Features</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-300">
            <li>Real-time market data simulation</li>
            <li>Order book with live bid/ask updates</li>
            <li>Time & Sales ticker</li>
            <li>Multiple order types (Market, Limit, Stop, Stop-Limit)</li>
            <li>Position and account management</li>
            <li>Workspace management system</li>
            <li>Minimalist dark theme optimized for trading</li>
          </ul>
        </div>

        <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
          <p className="text-yellow-400 text-sm">
            <strong>Note:</strong> The Solid.js source code is located in the{" "}
            <code className="bg-black px-2 py-1 rounded">src/</code> directory. All components use Solid.js reactive
            primitives (signals, effects, etc.) and will work once you run the app locally with Vite.
          </p>
        </div>
      </div>
    </div>
  )
}
