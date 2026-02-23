import * as React from 'react';
import { Button as EmailButton } from '@react-email/components';

interface ButtonProps {
  href: string;
  children: React.ReactNode;
}

export const Button = ({ href, children }: ButtonProps) => {
  return (
    <EmailButton
      href={href}
      style={{
        backgroundColor: '#00FF80',
        color: '#000000',
        padding: '12px 32px',
        borderRadius: '8px',
        textDecoration: 'none',
        fontWeight: '600',
        fontSize: '16px',
        display: 'inline-block',
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {children}
    </EmailButton>
  );
};
