import { Search } from 'lucide-react';

interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search…', className = '' }: SearchBarProps) {
    return (
        <div className={`relative flex-1 max-w-xs ${className}`.trim()}>
            <div className="flex items-center gap-1 h-8 px-2 rounded-md border border-input bg-background text-sm ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 cursor-text overflow-hidden">
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="flex-1 min-w-[60px] bg-transparent outline-none placeholder:text-muted-foreground text-xs"
                />
            </div>
        </div>
    );
}
