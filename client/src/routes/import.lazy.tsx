import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createLazyFileRoute('/import')({
    component: ImportRedirect,
});

function ImportRedirect() {
    const navigate = useNavigate();
    useEffect(() => {
        navigate({ to: '/settings', replace: true });
    }, [navigate]);
    return null;
}
