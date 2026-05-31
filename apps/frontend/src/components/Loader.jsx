import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSpinner } from '@fortawesome/free-solid-svg-icons'

export default function Loader() {
  return (
    <div style={styles.container}>
      <FontAwesomeIcon icon={faSpinner} spin style={styles.icon} />
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '50vh',
  },
  icon: {
    fontSize: '1.25rem',
    color: 'var(--color-text-muted)',
  },
}
