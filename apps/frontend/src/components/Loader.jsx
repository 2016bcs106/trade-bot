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
    minHeight: '60vh',
  },
  icon: {
    fontSize: '1.5rem',
    color: 'var(--color-primary)',
  },
}
